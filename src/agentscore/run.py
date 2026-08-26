"""Orchestration.

Concurrency is deliberately low. OpenRouter's free pool allows 20 requests a
minute across your whole key, and exceeding it returns 429s that count against
the daily quota anyway. Running eight workers against a limit of twenty per
minute does not make the suite finish faster, it makes it finish with holes in
it. So the run is paced to the limit rather than racing it.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

import httpx
from polyact import OpenRouterClient, TransportError
from polyact.client import FREE_ONLY
from polyact.usage import Usage, extract_usage

from .graders import JUDGE_PROMPT, GradeResult, grade_deterministic, parse_judge
from .tasks import Suite, Task


@dataclass
class Attempt:
    task_id: str
    model: str
    index: int
    output: str = ""
    passed: bool = False
    graded_by: str = "deterministic"
    reason: str = ""
    usage: Usage = field(default_factory=Usage)
    latency_s: float = 0.0
    error: str | None = None

    @property
    def counted(self) -> bool:
        """Whether this attempt is evidence about the model.

        A transport failure is an absent measurement, not a zero. Counting it
        as a zero means the model with the unluckiest network looks like the
        worst model, which is the single easiest way to publish a leaderboard
        that is quietly wrong.
        """
        return self.error is None


class RateLimiter:
    """A plain sliding window. Shared across every worker in the run."""

    def __init__(self, per_minute: int = 18):
        # 18 rather than 20: the judge calls come out of the same budget, and
        # sitting exactly on a limit means every clock skew is a 429.
        self.per_minute = per_minute
        self._times: list[float] = []
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self._times = [t for t in self._times if now - t < 60]
                if len(self._times) < self.per_minute:
                    self._times.append(now)
                    return
                await asyncio.sleep(60 - (now - self._times[0]) + 0.1)


async def run_suite(
    suite: Suite,
    client: OpenRouterClient,
    concurrency: int = 4,
    per_minute: int = 18,
) -> list[Attempt]:
    limiter = RateLimiter(per_minute)
    semaphore = asyncio.Semaphore(concurrency)
    jobs = [
        (task, model, index)
        for model in suite.models
        for task in suite.tasks
        for index in range(suite.repeats)
    ]

    async with httpx.AsyncClient(timeout=client.timeout) as http:
        async def worker(task: Task, model: str, index: int) -> Attempt:
            async with semaphore:
                return await _attempt(task, model, index, suite, client, http, limiter)

        return await asyncio.gather(*(worker(t, m, i) for t, m, i in jobs))


async def _attempt(
    task: Task,
    model: str,
    index: int,
    suite: Suite,
    client: OpenRouterClient,
    http: httpx.AsyncClient,
    limiter: RateLimiter,
) -> Attempt:
    attempt = Attempt(task_id=task.id, model=model, index=index)
    messages = []
    if task.system:
        messages.append({"role": "system", "content": task.system})
    messages.append({"role": "user", "content": task.prompt})

    await limiter.acquire()
    started = time.monotonic()
    try:
        payload = await client.complete(
            model=model,
            messages=messages,
            max_tokens=task.max_tokens,
            client=http,
            # A ceiling of zero, enforced by the provider refusing rather than
            # by this code checking. The suite names free models, but a model
            # id that is free today can be a paid endpoint next month and
            # nothing announces it — so the guarantee cannot rest on the list
            # being current. This one holds whatever the list says.
            max_price=FREE_ONLY,
        )
    except TransportError as exc:
        attempt.error = str(exc)
        attempt.latency_s = round(time.monotonic() - started, 2)
        return attempt

    attempt.latency_s = round(time.monotonic() - started, 2)
    attempt.usage = extract_usage(payload, "openrouter")
    attempt.output = _content(payload)

    if not attempt.output.strip():
        # An empty completion is a model result, not an error. Free endpoints
        # return them under load and a model that does it often should be
        # ranked for it.
        attempt.passed = False
        attempt.reason = "empty completion"
        return attempt

    results: list[GradeResult] = []
    for check in task.checks:
        result = grade_deterministic(attempt.output, check)
        if result is None:
            continue
        results.append(result)
        if not result.passed:
            # Short circuit. Nothing a judge could say changes a failed
            # deterministic check, and asking costs a request from the same
            # daily quota the run is spending.
            attempt.passed = False
            attempt.reason = f"{result.check}: {result.reason}"
            return attempt

    if task.needs_judge and suite.judge_model:
        rubric = next(c.rubric for c in task.checks if c.kind == "judge")
        await limiter.acquire()
        try:
            verdict_payload = await client.complete(
                model=suite.judge_model,
                messages=[
                    {
                        "role": "user",
                        "content": JUDGE_PROMPT.format(rubric=rubric, output=attempt.output),
                    }
                ],
                max_tokens=200,
                client=http,
                max_price=FREE_ONLY,
            )
        except TransportError as exc:
            attempt.error = f"judge unreachable: {exc}"
            return attempt
        judged = parse_judge(_content(verdict_payload))
        attempt.usage = attempt.usage + extract_usage(verdict_payload, "openrouter")
        attempt.passed = judged.passed
        attempt.graded_by = "judged"
        attempt.reason = judged.reason
        return attempt

    # Nothing gradeable ran. A judge task with no judge model configured, or a
    # task with no checks at all, reached here with an empty `results` and was
    # recorded as `passed=False, reason="all checks passed"` — a failure whose
    # stated reason says it passed, counted against the model as if it had
    # answered badly. It is an ungraded attempt, which is the same kind of
    # absence as an unreachable provider, and is dropped for the same reason.
    if not results:
        attempt.error = (
            "no check could be applied"
            + (" — the task needs a judge and no judge_model is set" if task.needs_judge else "")
        )
        return attempt

    attempt.passed = all(r.passed for r in results)
    attempt.reason = "; ".join(r.reason for r in results if not r.passed) or "all checks passed"
    return attempt


def _content(payload: dict) -> str:
    try:
        return payload["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""
