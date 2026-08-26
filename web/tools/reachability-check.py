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
import subprocess
import sys

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
  ("the reducer performs reading-pane actions while a draft covers the controls",
   "lib/environment/actions.ts", '  if (next.composer && READING_PANE.has(action.name)) {',
   '  if (false) {'),
  ("the reading-pane list drifts from the catalogue",
   "lib/environment/actions.ts", '  "mark_unread",\n', ''),
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

def refuse_if_already_mutated(paths):
    """Refuse to start on a tree that still carries a mutation.

    Every marker this tool writes is removed on exit, on SIGINT, SIGTERM and
    SIGHUP. It cannot be removed on SIGKILL, and a hard timeout kills rather
    than signals — which is exactly how a run of one of these tools once left
    `// MUTATED` in a source file, where it sat until the next test run failed
    for a reason nobody could place.

    So the first thing it does is look. A marker already in the tree means the
    last run died without cleaning up, and mutating on top of that would edit a
    file whose "original" is already wrong — turning a lost cleanup into a
    corrupted source file.
    """
    dirty = [q for q in dict.fromkeys(paths)
             if pathlib.Path(q).exists() and "// MUTATED" in pathlib.Path(q).read_text()]
    if dirty:
        print("\nREFUSING TO START — a previous run left a mutation behind:\n")
        for path in dirty:
            print(f"    {path}")
        print("\nRestore them (`git checkout -- <path>`) and run this again.\n")
        sys.exit(2)


refuse_if_already_mutated([case[1] for case in CASES])

results = []
for name, rel, old, new in CASES:
    path = pathlib.Path(rel)

    # A moved or renamed file is a gap in the checks, not a crash — and it is
    # reported as a skip rather than swallowed, because a case that silently
    # stops running looks exactly like a case that passes.
    if not path.exists():
        results.append((name, f"SKIP - {rel} does not exist"))
        continue

    original = _stash(path)
    if old not in original:
        results.append((name, "SKIP - anchor not found"))
        continue

    # A suite that is already red cannot prove anything by going red again.
    if not baseline_ok(REACH):
        results.append((name, "*** BASELINE RED - proves nothing ***"))
        continue

    path.write_text(original.replace(old, new, 1))
    try:
        r = subprocess.run(
            ["node", "--test", "--experimental-strip-types", *REACH],
            capture_output=True,
            text=True,
        )
    finally:
        path.write_text(original, encoding="utf-8")
    _ORIGINALS.pop(str(path), None)

    results.append((name, "CAUGHT" if r.returncode != 0 else "*** NOT CAUGHT ***"))

print(f"\n{'mutation':<52} result")
print("-" * 76)
for name, verdict in results:
    print(f"{name:<52} {verdict}")

missed = [name for name, verdict in results if verdict != "CAUGHT"]
print("\nall caught" if not missed else f"GAPS: {len(missed)}")
# A tool that reports a gap and exits 0 is a tool nothing is checking.
sys.exit(1 if missed else 0)
