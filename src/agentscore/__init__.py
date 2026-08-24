"""agentscore: a small, honest evaluation harness."""

from .graders import GradeResult, grade_deterministic, last_number, parse_judge
from .report import build_report, to_markdown
from .run import Attempt, RateLimiter, run_suite
from .stats import Interval, separated, wilson
from .tasks import Check, Suite, Task

__version__ = "0.1.0"

__all__ = [
    "Attempt",
    "Check",
    "GradeResult",
    "Interval",
    "RateLimiter",
    "Suite",
    "Task",
    "build_report",
    "grade_deterministic",
    "last_number",
    "parse_judge",
    "run_suite",
    "separated",
    "to_markdown",
    "wilson",
    "__version__",
]
