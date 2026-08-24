"""Task definitions.

A task is data, not code. That is a deliberate limit: it means a task can be
diffed, reviewed by someone who does not write Python, and versioned without
anyone worrying that a suite file can execute something.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Check:
    kind: str
    value: Any = None
    tolerance: float = 0.0
    case_sensitive: bool = False
    rubric: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> Check:
        return cls(
            kind=data["kind"],
            value=data.get("value"),
            tolerance=float(data.get("tolerance", 0.0)),
            case_sensitive=bool(data.get("case_sensitive", False)),
            rubric=data.get("rubric"),
        )


@dataclass
class Task:
    id: str
    prompt: str
    checks: list[Check] = field(default_factory=list)
    system: str | None = None
    tags: list[str] = field(default_factory=list)
    max_tokens: int = 1024

    @property
    def needs_judge(self) -> bool:
        return any(c.kind == "judge" for c in self.checks)

    @classmethod
    def from_dict(cls, data: dict) -> Task:
        return cls(
            id=data["id"],
            prompt=data["prompt"],
            checks=[Check.from_dict(c) for c in data.get("checks", [])],
            system=data.get("system"),
            tags=list(data.get("tags", [])),
            max_tokens=int(data.get("max_tokens", 1024)),
        )


@dataclass
class Suite:
    name: str
    tasks: list[Task]
    models: list[str] = field(default_factory=list)
    repeats: int = 3
    judge_model: str | None = None

    @classmethod
    def load(cls, path: str | Path) -> Suite:
        data = yaml.safe_load(Path(path).read_text())
        suite = cls(
            name=data.get("name", Path(path).stem),
            tasks=[Task.from_dict(t) for t in data.get("tasks", [])],
            models=list(data.get("models", [])),
            repeats=int(data.get("repeats", 3)),
            judge_model=data.get("judge_model"),
        )
        ids = [t.id for t in suite.tasks]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            # Caught here rather than downstream, because duplicate ids merge
            # silently in the report and inflate whichever task got copied.
            raise ValueError(f"duplicate task ids in {path}: {sorted(duplicates)}")
        return suite
