import pytest

from agentscore import Suite, Task
from agentscore.tasks import Check


def test_duplicate_task_ids_are_rejected_at_load(tmp_path=None):
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "suite.yaml"
        path.write_text(
            "name: dupes\n"
            "models: [m]\n"
            "tasks:\n"
            "  - id: same\n    prompt: a\n"
            "  - id: same\n    prompt: b\n"
        )
        # Duplicates merge silently in the report and inflate whichever task
        # got copied, so they fail at load rather than at read time.
        with pytest.raises(ValueError, match="duplicate task ids"):
            Suite.load(path)


def test_needs_judge_is_derived_from_the_checks():
    assert Task(id="t", prompt="p", checks=[Check(kind="judge", rubric="r")]).needs_judge
    assert not Task(id="t", prompt="p", checks=[Check(kind="exact", value="x")]).needs_judge


def test_task_defaults():
    task = Task.from_dict({"id": "t", "prompt": "p"})
    assert task.checks == []
    assert task.max_tokens == 1024
    assert task.system is None
