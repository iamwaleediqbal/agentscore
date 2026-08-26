"""Command line entry point."""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from polyact import OpenRouterClient

from .report import build_report, to_markdown
from .run import run_suite
from .tasks import Suite


def positive(value: str) -> int:
    """An argparse type that refuses zero and negatives up front."""
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError(f"must be at least 1, got {number}")
    return number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agentscore")
    parser.add_argument("suite", help="path to a suite YAML file")
    parser.add_argument("--out", default="results", help="output directory")
    parser.add_argument("--concurrency", type=int, default=4)
    # Positive, checked here rather than discovered in the limiter. A value of
    # zero meant "allow nothing", which the limiter expressed as an IndexError
    # on an empty deque after the run had already started.
    parser.add_argument(
        "--per-minute", type=positive, default=18, help="requests per minute (at least 1)"
    )
    parser.add_argument("--repeats", type=int, default=None, help="override suite repeats")
    parser.add_argument("--models", nargs="*", default=None, help="override suite models")
    args = parser.parse_args(argv)

    suite = Suite.load(args.suite)
    if args.repeats:
        suite.repeats = args.repeats
    if args.models:
        suite.models = args.models

    client = OpenRouterClient(
        referer="https://github.com/iamwaleediqbal/agentscore", title="agentscore"
    )
    attempts = asyncio.run(
        run_suite(suite, client, concurrency=args.concurrency, per_minute=args.per_minute)
    )

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = build_report(attempts, suite, generated_at)

    out = Path(args.out)
    (out / "history").mkdir(parents=True, exist_ok=True)
    stamp = generated_at.replace(":", "").replace("-", "")
    (out / "latest.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "history" / f"{suite.name}-{stamp}.json").write_text(json.dumps(report) + "\n")
    (out / "latest.md").write_text(to_markdown(report) + "\n")

    print(to_markdown(report))
    dropped = sum(m["dropped_attempts"] for m in report["models"])
    if dropped:
        print(f"\n{dropped} attempts never reached a model and were excluded.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
