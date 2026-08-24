import pytest

from agentscore import grade_deterministic, last_number, parse_judge
from agentscore.tasks import Check


def check(kind, value=None, **kw):
    return Check(kind=kind, value=value, **kw)


def test_exact_ignores_case_whitespace_and_a_trailing_full_stop():
    for output in ["Tokyo", "  tokyo  ", "TOKYO.", "Tokyo ."]:
        assert grade_deterministic(output, check("exact", "Tokyo")).passed, output


def test_exact_can_be_made_case_sensitive():
    assert not grade_deterministic("tokyo", check("exact", "Tokyo", case_sensitive=True)).passed


def test_numeric_takes_the_last_number_not_the_first():
    # "You asked about 9 pens and 4 notebooks. The answer is 1323."
    # Grading the first number grades the question, not the answer.
    output = "You bought 9 pens and 4 notebooks, so you pay 1323 rupees."
    assert grade_deterministic(output, check("numeric", 1323)).passed


def test_numeric_handles_thousands_separators():
    assert last_number("The total comes to 1,323") == 1323.0


def test_numeric_with_no_number_fails_with_a_useful_reason():
    result = grade_deterministic("I cannot calculate that.", check("numeric", 5))
    assert not result.passed
    assert "no number" in result.reason


def test_numeric_tolerance():
    assert grade_deterministic("3.14159", check("numeric", 3.14, tolerance=0.01)).passed
    assert not grade_deterministic("3.20", check("numeric", 3.14, tolerance=0.01)).passed


def test_json_valid_accepts_a_markdown_fenced_answer():
    # Models fence JSON however firmly you ask them not to. Failing on the
    # fence measures formatting compliance when the task was about content.
    output = '```json\n{"city": "Tokyo", "country": "Japan"}\n```'
    assert grade_deterministic(output, check("json_valid", ["city", "country"])).passed


def test_json_valid_reports_which_keys_are_missing():
    result = grade_deterministic('{"city": "Tokyo"}', check("json_valid", ["city", "country"]))
    assert not result.passed
    assert "country" in result.reason


def test_json_valid_fails_on_prose():
    assert not grade_deterministic("The capital is Tokyo.", check("json_valid")).passed


def test_contains_all_lists_what_was_missing():
    result = grade_deterministic("alpha and beta", check("contains_all", ["alpha", "gamma"]))
    assert not result.passed
    assert "gamma" in result.reason


def test_not_contains():
    assert grade_deterministic("a bright day", check("not_contains", "zebra")).passed
    assert not grade_deterministic("a zebra", check("not_contains", "Zebra")).passed


def test_judge_checks_are_deferred_not_graded_here():
    assert grade_deterministic("anything", check("judge")) is None


def test_unknown_check_kind_is_a_loud_error():
    with pytest.raises(ValueError, match="unknown check kind"):
        grade_deterministic("x", check("vibes"))


def test_judge_verdict_is_read():
    result = parse_judge('{"pass": true, "reason": "correctly rejected the premise"}')
    assert result.passed
    assert result.kind == "judged"


def test_judge_verdict_survives_a_fence():
    assert parse_judge('```json\n{"pass": false, "reason": "guessed a year"}\n```').passed is False


def test_unparseable_judge_output_fails_closed():
    # Defaulting to pass would mean every judge outage silently inflates every
    # score in the run, and it would look like the models improved that night.
    assert not parse_judge("I think it is probably fine").passed
    assert not parse_judge('{"verdict": "good"}').passed
    assert not parse_judge("").passed
