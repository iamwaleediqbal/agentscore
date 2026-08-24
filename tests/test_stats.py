import pytest

from agentscore import separated, wilson


def test_three_of_three_is_not_reported_as_certainty():
    interval = wilson(3, 3)
    assert interval.point == 1.0
    # The whole reason Wilson is used: the naive interval reports width zero
    # here, which would present three attempts as proof.
    assert 0.3 < interval.low < 0.6
    assert interval.high == 1.0


def test_zero_of_five_still_has_a_ceiling():
    interval = wilson(0, 5)
    assert interval.point == 0.0
    assert interval.low == 0.0
    assert 0.3 < interval.high < 0.6


def test_more_trials_narrow_the_interval():
    assert wilson(50, 100).width < wilson(5, 10).width < wilson(1, 2).width


def test_interval_never_leaves_the_unit_range():
    for successes, trials in [(0, 1), (1, 1), (0, 3), (3, 3), (1, 100), (99, 100)]:
        interval = wilson(successes, trials)
        assert 0.0 <= interval.low <= interval.point <= interval.high <= 1.0


def test_no_trials_is_maximum_uncertainty_not_zero():
    interval = wilson(0, 0)
    assert (interval.low, interval.high) == (0.0, 1.0)


def test_clearly_different_results_are_separated():
    assert separated(wilson(95, 100), wilson(10, 100))


def test_close_results_on_small_samples_are_not_separated():
    # 4/5 versus 3/5 is not a ranking, it is noise, and the report must not
    # order them.
    assert not separated(wilson(4, 5), wilson(3, 5))


def test_symmetry():
    low = wilson(2, 10)
    high = wilson(8, 10)
    assert low.point == pytest.approx(1 - high.point)
    assert low.low == pytest.approx(1 - high.high)
