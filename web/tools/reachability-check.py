#!/usr/bin/env python3
"""
Check that the reachability guards actually fail when broken.

tests/reachable.test.ts cross-checks three layers that have drifted apart
repeatedly: the reducer, the interface, and the browser driver. These mutations
prove each assertion bites — one of them originally did not, because a
fixed-width source window bled into the next switch case and found an `open`
belonging to a different action.

    python3 tools/reachability-check.py

Every file is restored afterwards, including when a mutation fails.
"""

import atexit
import pathlib
import signal
import sys
import subprocess

CASES = [
  ("reading-pane control used WITHOUT opening the message",
   "runner/driver.ts", '      // All reading-pane controls, so the message has to be open first.\n      await click(page, `open-${id}`);\n      const control = {',
   '      const control = {'),
  ("reducer performs forward again, with no control on screen",
   "lib/environment/actions.ts", 'case "forward":\n      return fail(state, "this interface has no forward control");',
   'case "forward": {\n      const email = find();\n      if (!email) return fail(state, "no email");\n      email.read = true;\n      return { ok: true, state: next };\n    }'),
  ("reducer performs mark_read again",
   "lib/environment/actions.ts", 'case "mark_read":\n      return fail(state, "there is no mark-read control; opening a message marks it read");',
   'case "mark_read": {\n      const email = find();\n      if (!email) return fail(state, "no email");\n      email.read = true;\n      return { ok: true, state: next };\n    }'),
  ("an action exists but the model is never told about it",
   "lib/environment/catalog.ts", '  not_spam: {', '  not_spam_XX: {'),
  ("an unavailable action is not marked as such in the prompt",
   "lib/environment/catalog.ts", 'doc.reach === "none" ? "  — NOT AVAILABLE in this interface" : ""',
   '"" ? "  — NOT AVAILABLE in this interface" : ""'),
  ("the prompt goes back to a hand-written action list",
   "lib/environment/serialize.ts", '${actionReference()}', '  archive     {"id"}\n  trash       {"id"}'),
  ("an action is offered to the model that the browser driver cannot perform",
   "runner/driver.ts", '    case "save_draft":\n      return click(page, "composer-save");',
   '    case "save_draft_XX":\n      return click(page, "composer-save");'),
  ("an action is offered to the model that the parser will reject",
   "lib/environment/actions.ts", '  "save_draft",\n', ''),
  ("the serialised world stops telling the model what the screen shows",
   "lib/environment/serialize.ts", ' received=${email.receivedAt}', ''),
]
# ---------------------------------------------------------------- safety net
#
# Restore on the way out, whatever the way out is.
#
# Restoring after the subprocess covers a mutation that fails. It does not cover
# the process being killed between writing the mutant and writing the original
# back — a Ctrl-C, or a `timeout` wrapping the pre-push checks. That happened,
# and it left `# MUTATED` sitting in a workflow file where the next commit would
# have taken it. A tool that edits source in place has to survive its own death.

_ORIGINALS = {}


def _stash(path):
    text = path.read_text(encoding="utf-8")
    _ORIGINALS[str(path)] = text
    return text


def _restore_all():
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


REACH = ["tests/reachable.test.ts"]

results=[]
for name, rel, old, new in CASES:
    p=pathlib.Path(rel)
    if not p.exists():
        results.append((name, f"SKIP - {rel} does not exist")); continue
    original=_stash(p)
    if old not in original: results.append((name,"SKIP - anchor not found")); continue
    if not baseline_ok(REACH):
        results.append((name, "*** BASELINE RED - proves nothing ***")); continue
    p.write_text(original.replace(old,new,1))
    try:
        r=subprocess.run(["node","--test","--experimental-strip-types",*REACH],capture_output=True,text=True)
    finally:
        p.write_text(original, encoding="utf-8")
    _ORIGINALS.pop(str(p), None)
    results.append((name,"CAUGHT" if r.returncode!=0 else "*** NOT CAUGHT ***"))
print(f"\n{'mutation':<52} result"); print("-"*76)
for n,v in results: print(f"{n:<52} {v}")
missed=[n for n,v in results if v!="CAUGHT"]
print("\nall caught" if not missed else f"GAPS: {len(missed)}")
# A tool that reports a gap and exits 0 is a tool nothing is checking.
sys.exit(1 if missed else 0)
