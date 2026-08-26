"""Grading.

Two kinds, and the distinction is the whole design.

**Deterministic** checks are cheap, instant and reproducible. If a task can be
graded this way it is, and the run never spends a token on judging it.

**Judged** checks call a model. They are for the tasks where correctness is
genuinely a matter of reading, and they are a last resort rather than a default,
for two reasons. They cost a request from the same daily quota the run itself is
spending, and a judge is a model, so it has its own failure modes and its own
variance sitting on top of the variance you were trying to measure.

Deterministic runs first. If a deterministic check fails, the judge is never
asked, because there is nothing left to be uncertain about.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

NUMBER = re.compile(r"-?\d[\d,]*\.?\d*")


@dataclass
class GradeResult:
    passed: bool
    kind: str  # "deterministic" | "judged"
    reason: str
    check: str


def normalise(text: str, case_sensitive: bool = False) -> str:
    text = " ".join((text or "").split())
    text = text.strip().strip(".").strip()
    return text if case_sensitive else text.lower()


def last_number(text: str) -> float | None:
    """The last number in the answer, not the first.

    Models restate the question before answering it. Taking the first number
    grades the question rather than the answer, which is a mistake that makes
    every model look worse and correlates with verbosity rather than skill.
    """
    matches = NUMBER.findall(text or "")
    if not matches:
        return None
    try:
        return float(matches[-1].replace(",", ""))
    except ValueError:
        return None


def grade_deterministic(output: str, check) -> GradeResult | None:
    """Grade one check. Returns None if this check needs a judge."""
    kind = check.kind

    if kind == "exact":
        got = normalise(output, check.case_sensitive)
        want = normalise(str(check.value), check.case_sensitive)
        return GradeResult(got == want, "deterministic", f"got {got!r}, want {want!r}", kind)

    if kind == "contains":
        haystack = output if check.case_sensitive else (output or "").lower()
        needle = str(check.value) if check.case_sensitive else str(check.value).lower()
        return GradeResult(needle in haystack, "deterministic", f"looked for {needle!r}", kind)

    if kind == "contains_all":
        haystack = output if check.case_sensitive else (output or "").lower()
        needles = [
            str(v) if check.case_sensitive else str(v).lower() for v in (check.value or [])
        ]
        missing = [n for n in needles if n not in haystack]
        return GradeResult(not missing, "deterministic", f"missing {missing}", kind)

    if kind == "not_contains":
        haystack = output if check.case_sensitive else (output or "").lower()
        needle = str(check.value) if check.case_sensitive else str(check.value).lower()
        return GradeResult(needle not in haystack, "deterministic", f"must avoid {needle!r}", kind)

    if kind == "regex":
        match = re.search(str(check.value), output or "", re.IGNORECASE | re.DOTALL)
        return GradeResult(bool(match), "deterministic", f"pattern {check.value!r}", kind)

    if kind == "numeric":
        got = last_number(output)
        if got is None:
            return GradeResult(False, "deterministic", "no number in output", kind)
        want = float(check.value)
        ok = abs(got - want) <= check.tolerance
        return GradeResult(ok, "deterministic", f"got {got}, want {want}+-{check.tolerance}", kind)

    if kind == "json_valid":
        try:
            parsed = json.loads(_strip_fence(output))
        except (json.JSONDecodeError, TypeError) as exc:
            return GradeResult(False, "deterministic", f"invalid JSON: {exc}", kind)
        # A model answering `5` or `"Tokyo"` produces valid JSON that is not an
        # object. `k not in 5` raises TypeError, which nothing above catches and
        # `asyncio.gather` does not isolate — so one badly-shaped completion
        # aborted every remaining attempt in the suite. It is a failed check,
        # not an exception.
        if check.value and not isinstance(parsed, dict):
            return GradeResult(
                False, "deterministic", f"JSON is {type(parsed).__name__}, not an object", kind
            )
        if check.value:
            missing = [k for k in check.value if k not in parsed]
            return GradeResult(not missing, "deterministic", f"missing keys {missing}", kind)
        return GradeResult(True, "deterministic", "parsed", kind)

    if kind == "judge":
        return None

    raise ValueError(f"unknown check kind {kind!r}")


def _strip_fence(text: str) -> str:
    """Models wrap JSON in markdown fences however hard you ask them not to.

    Stripping the fence is not leniency, it is refusing to measure formatting
    compliance when the task was about content. If format is what you care
    about, that is a separate `regex` check and it should say so.
    """
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


JUDGE_PROMPT = """You are grading one answer against a rubric.

Rubric:
{rubric}

Answer:
{output}

Reply with JSON only: {{"pass": true or false, "reason": "one short sentence"}}
Judge only against the rubric. Do not reward length, confidence or style."""


def parse_judge(raw: str) -> GradeResult:
    """Read a judge's verdict, and fail closed when it is unreadable.

    A judge that returns something unparseable is not a pass. Defaulting to
    pass here would mean every judge outage silently inflates every score in
    the run, and it would look like the models got better that night.
    """
    try:
        verdict = json.loads(_strip_fence(raw))
    except (json.JSONDecodeError, TypeError):
        return GradeResult(False, "judged", "judge returned unparseable output", "judge")
    if not isinstance(verdict, dict) or "pass" not in verdict:
        return GradeResult(False, "judged", "judge verdict missing a pass field", "judge")
    return GradeResult(
        bool(verdict["pass"]), "judged", str(verdict.get("reason", ""))[:300], "judge"
    )
