"""Aggregation that refuses to report a single run as a result.

One attempt at one task tells you almost nothing. Free models in particular
swing hard between attempts, and a leaderboard built from single runs reorders
itself every night for no reason anyone can explain.

So every task is attempted ``repeats`` times and reported as a pass rate with a
confidence interval. The interval is the honest part: it is what stops a 3/3 on
three attempts being presented as "100%".
"""

from __future__ import annotations

import math
from dataclasses import dataclass

Z_95 = 1.959963984540054


@dataclass(frozen=True)
class Interval:
    point: float
    low: float
    high: float

    @property
    def width(self) -> float:
        return self.high - self.low


def wilson(successes: int, trials: int, z: float = Z_95) -> Interval:
    """Wilson score interval.

    Not the textbook normal approximation, which is the one most dashboards
    use. At the sample sizes an eval actually runs, that approximation puts the
    bounds outside 0 and 1 and reports a width of exactly zero for 0/5 and 5/5,
    which is precisely where an eval needs an interval most. Wilson stays inside
    the unit range and stays wide when the evidence is thin.

    3 of 3 passes reports 100% with a lower bound near 44%, which is the
    correct amount of confidence to have in three attempts.
    """
    if trials <= 0:
        return Interval(0.0, 0.0, 1.0)

    p = successes / trials
    denominator = 1 + z**2 / trials
    centre = p + z**2 / (2 * trials)
    margin = z * math.sqrt(p * (1 - p) / trials + z**2 / (4 * trials**2))
    low = (centre - margin) / denominator
    high = (centre + margin) / denominator
    # The interval must contain the point estimate. At p=0 and p=1 the two
    # halves of the formula cancel in exact arithmetic but not in floating
    # point, which leaves a bound a hair on the wrong side of the estimate.
    return Interval(
        point=p,
        low=max(0.0, min(low, p)),
        high=min(1.0, max(high, p)),
    )


def separated(a: Interval, b: Interval) -> bool:
    """Whether two results can be ordered at all.

    A leaderboard that ranks overlapping intervals is inventing a difference.
    The report uses this to mark ties instead of pretending to a position.
    """
    return a.low > b.high or b.low > a.high
