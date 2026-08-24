"""Reporting.

The output is one JSON file that a static site can read directly. There is no
database and no server, because the compute happens in CI on a schedule and the
result is a file. Anything that only ever needs to be read as it was last
written does not need a database, and a portfolio project that provisions one
is answering a question nobody asked.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .stats import Interval, separated, wilson


def build_report(attempts, suite, generated_at: str) -> dict[str, Any]:
    by_model: dict[str, list] = defaultdict(list)
    for attempt in attempts:
        by_model[attempt.model].append(attempt)

    models = []
    for model, model_attempts in by_model.items():
        counted = [a for a in model_attempts if a.counted]
        dropped = len(model_attempts) - len(counted)
        passes = sum(1 for a in counted if a.passed)
        interval = wilson(passes, len(counted))

        per_task = []
        by_task: dict[str, list] = defaultdict(list)
        for attempt in counted:
            by_task[attempt.task_id].append(attempt)
        for task_id, task_attempts in sorted(by_task.items()):
            task_passes = sum(1 for a in task_attempts if a.passed)
            per_task.append(
                {
                    "task_id": task_id,
                    "passes": task_passes,
                    "attempts": len(task_attempts),
                    "consistent": task_passes in (0, len(task_attempts)),
                    "sample_failure": next(
                        (a.reason for a in task_attempts if not a.passed), None
                    ),
                }
            )

        models.append(
            {
                "model": model,
                "pass_rate": round(interval.point, 4),
                "ci_low": round(interval.low, 4),
                "ci_high": round(interval.high, 4),
                "passes": passes,
                "attempts": len(counted),
                "dropped_attempts": dropped,
                "flaky_tasks": sum(1 for t in per_task if not t["consistent"]),
                "median_latency_s": _median([a.latency_s for a in counted]),
                "total_tokens": sum(a.usage.total_tokens for a in counted),
                "judged_share": round(
                    sum(1 for a in counted if a.graded_by == "judged") / max(1, len(counted)), 3
                ),
                "tasks": per_task,
            }
        )

    models.sort(key=lambda m: (-m["pass_rate"], m["model"]))
    _mark_ties(models)

    return {
        "suite": suite.name,
        "generated_at": generated_at,
        "repeats": suite.repeats,
        "task_count": len(suite.tasks),
        "judge_model": suite.judge_model,
        "models": models,
        "notes": [
            "Pass rate is over every repeat, not a single run.",
            (
                "Intervals are Wilson 95%. Overlapping intervals are marked "
                "tied rather than ranked."
            ),
            "Attempts that never reached a model are dropped, not scored zero.",
        ],
    }


def _mark_ties(models: list[dict]) -> None:
    """Assign ranks, sharing a rank wherever the intervals overlap.

    A leaderboard that orders overlapping intervals is inventing a difference
    it cannot support. Showing the tie is less satisfying and more true.

    Rank is counted against every other model rather than against the one
    above. Comparing only to the neighbour makes overlap transitive: a chain
    of models that each overlap the next collapses into one giant tie even
    when the top and bottom of the chain are plainly different.
    """
    intervals = [
        Interval(m["pass_rate"], m["ci_low"], m["ci_high"]) for m in models
    ]
    for index, model in enumerate(models):
        mine = intervals[index]
        better = sum(
            1
            for other_index, other in enumerate(intervals)
            if other_index != index and separated(other, mine) and other.point > mine.point
        )
        model["rank"] = better + 1

    counts: dict[int, int] = {}
    for model in models:
        counts[model["rank"]] = counts.get(model["rank"], 0) + 1
    for model in models:
        model["tied"] = counts[model["rank"]] > 1


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 2)
    return round((ordered[middle - 1] + ordered[middle]) / 2, 2)


def to_markdown(report: dict) -> str:
    lines = [
        f"# {report['suite']}",
        "",
        (
            f"{report['task_count']} tasks, {report['repeats']} attempts each. "
            f"Generated {report['generated_at']}."
        ),
        "",
        "| # | Model | Pass rate | 95% CI | Flaky tasks | Median latency | Dropped |",
        "|---|---|---|---|---|---|---|",
    ]
    for model in report["models"]:
        rank = f"{model['rank']}=" if model["tied"] else str(model["rank"])
        lines.append(
            f"| {rank} | `{model['model']}` | {model['pass_rate'] * 100:.0f}% "
            f"| {model['ci_low'] * 100:.0f}-{model['ci_high'] * 100:.0f}% "
            f"| {model['flaky_tasks']} | {model['median_latency_s']}s "
            f"| {model['dropped_attempts']} |"
        )
    lines += ["", *(f"- {note}" for note in report["notes"])]
    return "\n".join(lines)
