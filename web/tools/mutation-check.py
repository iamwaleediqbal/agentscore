#!/usr/bin/env python3
"""
Check that the spending guards actually fail when broken.

A passing test proves nothing on its own. Two assertions in
tests/free-only.test.ts passed while matching a substring that survived the very
bug they claimed to guard: /BUDGET_STATE/ still matches `const BUDGET_STATE =
""`, and /isPaidModel/ still matches `isPaidModelXX`. Both guards were decorative
until this script found them.

So each guard is verified by reintroducing the bug it exists for and confirming
the suite goes red. Run from the project root:

    python3 tools/mutation-check.py

Every file is restored afterwards, including when a mutation fails. Run it after
touching anything to do with model selection, budgets or price ceilings.
"""

import atexit
import pathlib
import signal
import subprocess
import sys

CASES = [
  ("BUG 1: budget resets each task (drop the state file)",
   "runner/run.ts", 'const BUDGET_STATE = process.env.BUDGET_STATE ?? "";',
                    'const BUDGET_STATE = "";  // MUTATED'),
  ("BUG 1b: script stops creating the session state file",
   "record-runs.sh", 'export BUDGET_STATE', '# MUTATED: no export'),
  ("BUG 2: decide paid-ness from the model name again",
   "lib/models.ts", 'export async function isPaidModel',
                    'export async function isPaidModelXX'),
  ("BUG 3: trust only the per-call cost, drop the account anchor",
   "runner/run.ts", 'Math.max(accountSpend, spent)', 'spent /* MUTATED */'),
  ("BUG 4: remove the hard request cap",
   "runner/run.ts", 'that is the hard cap', 'MUTATED'),
  ("BUG 5: let a paid model run with no budget",
   "runner/run.ts", 'if (PAID && !(BUDGET > 0)) {', 'if (false) {  // MUTATED'),
  ("BUG 6: stop sending the price ceiling",
   "runner/run.ts", 'provider: PAID ? AFFORDABLE : FREE_ONLY,', '// MUTATED'),
  ("BUG 7: let reasoning tokens back on by default",
   "lib/models.ts", 'process.env.REASONING ?? "minimal"', 'process.env.REASONING ?? "high"'),
  ("BUG 10: stop retrying without reasoning when a model refuses it",
   "runner/run.ts", 'dropReasoning = true;', '/* MUTATED */;'),
  ("BUG 11: discard the error body on a rejected request",
   "runner/run.ts", 'const body = await response.text();', 'const body = "";'),
  ("BUG 8: hide reasoning instead of disabling it (still billed)",
   "lib/models.ts", '{ reasoning: { effort: REASONING_EFFORT } }', '{ reasoning: { exclude: true } }'),
  ("BUG 9: stop sending the reasoning setting from the runner",
   "runner/run.ts", '...(dropReasoning ? {} : reasoningOption()),', '// MUTATED'),

  ("the action space stops being sent as tools",
   "runner/run.ts", "            tools,\n", "            // MUTATED\n"),

  ("an undocumented tool_choice value goes back to every provider",
   "runner/run.ts", 'dropToolChoice ? {} : { tool_choice: "auto" }',
   'dropToolChoice ? {} : { tool_choice: "required" }'),

  ("a prose reply is discarded instead of measured",
   "runner/run.ts", "        : parseTurn(reply.content);", "        : { action: null, thought: \"\" };  // MUTATED"),

  ("an endpoint that refuses tool_choice is written off again",
   "lib/models.ts", "  return /tool_choice/i.test(detail);", "  return false;  // MUTATED"),

  ("a model without tool calling is offered turns it cannot use",
   "lib/models.ts", '.filter((m) => (m.supported_parameters ?? []).includes("tools"))',
   "// MUTATED"),

]

# ---------------------------------------------------------------- safety net
#
# Restore on the way out, whatever the way out is.
#
# The per-case `finally` covers a mutation that fails. It does not cover the
# process being killed between writing the mutant and writing the original back
# — a Ctrl-C, or a `timeout` wrapping the pre-push checks. That happened, and it
# left `# MUTATED` sitting in a workflow file where the next commit would have
# taken it. A tool that edits source in place has to survive its own death.

_ORIGINALS = {}


def _stash(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    _ORIGINALS[str(path)] = text
    return text


def _restore_all() -> None:
    for name, text in list(_ORIGINALS.items()):
        try:
            pathlib.Path(name).write_text(text, encoding="utf-8")
        except OSError:
            print(f"  COULD NOT RESTORE {name} — check `git diff` before committing")
    _ORIGINALS.clear()


atexit.register(_restore_all)

for _sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    # sys.exit from a handler raises SystemExit, so atexit still runs.
    signal.signal(_sig, lambda *_: sys.exit(130))


# ---------------------------------------------------------------- baseline
#
# A mutation is "caught" when the suite goes red. That inference only holds if
# the suite was green to begin with — and for a long time it did not hold here:
# the tests these tools ran included a file that had been deleted, node exited
# non-zero because the path did not resolve, and every case reported CAUGHT
# without a mutation ever changing an outcome. Two of the guards behind that
# were, it turned out, guarding nothing.
#
# So the test list is run once, unmutated, before anything is edited. A list
# that is already red proves nothing about any mutation, and says so.

_BASELINE = {}


def baseline_ok(tests):
    key = tuple(tests)
    if key not in _BASELINE:
        r = subprocess.run(["node", "--test", "--experimental-strip-types", *tests],
                           capture_output=True, text=True)
        _BASELINE[key] = r.returncode == 0
        if not _BASELINE[key]:
            print(f"  BASELINE RED: {' '.join(tests)}")
    return _BASELINE[key]


FREE = ["tests/free-only.test.ts"]

results = []
for name, rel, old, new in CASES:
    p = pathlib.Path(rel)
    if not p.exists():
        results.append((name, f"SKIP - {rel} does not exist"))
        continue
    original = _stash(p)
    if old not in original:
        results.append((name, "SKIP - anchor not found"))
        continue
    if not baseline_ok(FREE):
        results.append((name, "*** BASELINE RED - proves nothing ***"))
        continue
    p.write_text(original.replace(old, new, 1), encoding="utf-8")
    try:
        r = subprocess.run(["node", "--test", "--experimental-strip-types", *FREE],
                           capture_output=True, text=True)
    finally:
        p.write_text(original, encoding="utf-8")
    _ORIGINALS.pop(str(p), None)
    caught = r.returncode != 0
    results.append((name, "CAUGHT" if caught else "*** NOT CAUGHT ***"))

print(f"\n{'mutation':<52} {'result'}")
print("-" * 78)
for name, verdict in results:
    print(f"{name:<52} {verdict}")
missed = [n for n, v in results if v != "CAUGHT"]
print()
print("all mutations caught" if not missed else f"GAPS: {len(missed)}")
# A tool that reports a gap and exits 0 is a tool nothing is checking. push.sh
# and CI both read the exit code, and read nothing else.
sys.exit(1 if missed else 0)
