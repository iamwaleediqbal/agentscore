from polyact.usage import Usage

from agentscore import Attempt, Suite, Task, build_report, to_markdown


def suite(**kw):
    return Suite(
        name="test",
        tasks=[Task(id="t1", prompt="p"), Task(id="t2", prompt="p")],
        models=["a", "b"],
        repeats=kw.get("repeats", 3),
    )


def attempt(model, task_id, passed, error=None, latency=1.0):
    return Attempt(
        task_id=task_id,
        model=model,
        index=0,
        passed=passed,
        error=error,
        latency_s=latency,
        usage=Usage(input_tokens=10, output_tokens=10, calls=1),
    )


def test_transport_failures_are_dropped_rather_than_scored_zero():
    attempts = [
        attempt("a", "t1", True),
        attempt("a", "t1", True),
        attempt("a", "t1", False, error="502 from proxy"),
    ]
    report = build_report(attempts, suite(), "2026-08-24T00:00:00Z")
    model = report["models"][0]
    # 2 of 2, not 2 of 3. The model with the unluckiest network must not look
    # like the worst model.
    assert model["attempts"] == 2
    assert model["passes"] == 2
    assert model["dropped_attempts"] == 1
    assert model["pass_rate"] == 1.0


def test_a_task_that_passes_sometimes_is_marked_flaky():
    attempts = [
        attempt("a", "t1", True),
        attempt("a", "t1", False),
        attempt("a", "t2", True),
        attempt("a", "t2", True),
    ]
    report = build_report(attempts, suite(), "now")
    model = report["models"][0]
    assert model["flaky_tasks"] == 1
    flaky = next(t for t in model["tasks"] if t["task_id"] == "t1")
    assert flaky["consistent"] is False


def test_overlapping_intervals_share_a_rank():
    # 4/5 versus 3/5 is noise. Ordering them invents a difference.
    attempts = [attempt("a", "t1", i < 4) for i in range(5)]
    attempts += [attempt("b", "t1", i < 3) for i in range(5)]
    report = build_report(attempts, suite(), "now")
    assert [m["rank"] for m in report["models"]] == [1, 1]
    assert report["models"][1]["tied"] is True


def test_clearly_better_model_gets_rank_one_alone():
    attempts = [attempt("a", "t1", True) for _ in range(30)]
    attempts += [attempt("b", "t1", False) for _ in range(30)]
    report = build_report(attempts, suite(), "now")
    assert [m["rank"] for m in report["models"]] == [1, 2]
    assert report["models"][0]["tied"] is False


def test_median_latency_is_not_dragged_by_one_slow_call():
    attempts = [
        attempt("a", "t1", True, latency=1.0),
        attempt("a", "t1", True, latency=1.0),
        attempt("a", "t1", True, latency=90.0),
    ]
    report = build_report(attempts, suite(), "now")
    assert report["models"][0]["median_latency_s"] == 1.0


def test_a_model_with_only_failed_transport_reports_no_attempts():
    attempts = [attempt("a", "t1", False, error="boom") for _ in range(3)]
    report = build_report(attempts, suite(), "now")
    model = report["models"][0]
    assert model["attempts"] == 0
    assert model["dropped_attempts"] == 3
    # No evidence means maximum uncertainty, not a zero score.
    assert model["ci_high"] == 1.0


def test_markdown_marks_ties_visibly():
    attempts = [attempt("a", "t1", i < 4) for i in range(5)]
    attempts += [attempt("b", "t1", i < 3) for i in range(5)]
    text = to_markdown(build_report(attempts, suite(), "now"))
    assert "| 1= |" in text


def test_overlap_is_not_transitive():
    # A overlaps B, B overlaps C, but A and C are clearly different. Comparing
    # only to the neighbour above collapses all three into one tie.
    attempts = [attempt("a", "t1", i < 30) for i in range(30)]      # 100%
    attempts += [attempt("b", "t1", i < 22) for i in range(30)]     # 73%
    attempts += [attempt("c", "t1", i < 15) for i in range(30)]     # 50%
    report = build_report(attempts, suite(), "now")
    ranks = {m["model"]: m["rank"] for m in report["models"]}
    assert ranks["a"] == 1
    assert ranks["c"] > ranks["a"]
