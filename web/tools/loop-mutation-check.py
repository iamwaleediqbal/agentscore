#!/usr/bin/env python3
"""
Check that the end-to-end agent loop test actually fails when the loop breaks.

tests/agent-loop.test.ts is the only test that closes the loop: a policy that
sees *nothing but the serialised observation* has to find its target, act
through the real parser and the real reducer, and be graded. It exists to catch
the three failures that reached a paid run before it did — a model handed blank
rows, an action missing from its prompt, and a folder it could not reach.

A test like that is worth exactly as much as the mutations it catches. So each
of those failures is reintroduced here and the suite must go red.

    python3 tools/loop-mutation-check.py

Every file is restored afterwards, including when a mutation fails.
"""

import atexit
import pathlib
import signal
import subprocess
import sys

LOOP = ["tests/agent-loop.test.ts"]
GRADING = ["tests/misgrading.test.ts", "tests/grade.test.ts", "tests/solvable.test.ts"]
SEAM = ["tests/grader-is-generic.test.ts", "tests/grade.test.ts"]
SPLIT = ["tests/automation.test.ts", "tests/layout.test.ts", "tests/deployment.test.ts"]
MATRIX = ["tests/reducer-matrix.test.ts"]
PERSIST = ["tests/persistence.test.ts"]
QUOTA = ["tests/quota.test.ts"]
FLOW = ["tests/workflows.test.ts"]
DEPLOY = ["tests/deployment.test.ts"]
LAYOUT = ["tests/layout.test.ts"]
COORDS = ["tests/computer.test.ts"]
CONFORM = ["tests/conformance.test.ts"]
BUDGET = ["tests/solvable.test.ts", "tests/computer.test.ts"]
CLI = ["tests/workflows.test.ts", "tests/runner-cli.test.ts"]
ALL = ["tests/agent-loop.test.ts", "tests/solvable.test.ts", "tests/grade.test.ts",
       "tests/reachable.test.ts", "tests/search.test.ts"]

CASES = [
  # (name, file, old, new, which tests must go red)
  ("the model is handed rows with no subject",
   "lib/environment/serialize.ts", 'lines.push(`  subject: ${email.subject || "(no subject)"}`);',
                           'lines.push("  subject: (no subject)");  // MUTATED', LOOP),

  ("the model is handed rows with no body at all",
   "lib/environment/serialize.ts", 'lines.push(`  body: ${body.replace(/\\n+/g, " ") || "(empty)"}`);',
                           'lines.push("  body: (empty)");  // MUTATED', LOOP),

  ("body previews truncated to nothing, hiding what the task names",
   "lib/environment/serialize.ts", 'const BODY_PREVIEW = 140;', 'const BODY_PREVIEW = 0;  // MUTATED', LOOP),

  ("serialize ignores the open folder and always shows the inbox",
   "lib/environment/serialize.ts", '(e) => e.folder === state.folder && matchesQuery(e, state.query),',
                           '(e) => e.folder === "inbox" && matchesQuery(e, state.query),  // MUTATED', LOOP),

  ("the spam folder becomes unreachable",
   "lib/environment/actions.ts", 'if (!FOLDER_ORDER.includes(folder)) {',
                         'if (!FOLDER_ORDER.includes(folder) || folder === "spam") {  // MUTATED', LOOP),

  ("rescuing from spam silently does nothing",
   "lib/environment/actions.ts", '''      email.read = true;
      email.folder = "inbox";
      next.selectedId = null;
      return { ok: true, state: next };
    }

    /** Put something back where it came from. Trash only. */''',
                         '''      return { ok: true, state: next };  // MUTATED
    }

    /** Put something back where it came from. Trash only. */''', LOOP),

  ("the reducer performs a forward the interface has no control for",
   "lib/environment/actions.ts", 'return fail(state, "this interface has no forward control");',
                         'return { ok: true, state: next };  // MUTATED', LOOP),

  ("permanent delete stops deleting",
   "lib/environment/actions.ts", 'next.emails = next.emails.filter((e) => e.id !== email.id);',
                         '// MUTATED', LOOP),

  ("the prompt stops listing the actions, so the agent is told nothing",
   "lib/environment/serialize.ts", '${actionReference()}', '(see docs)  // MUTATED', LOOP),

  ("grading stops counting unrequested changes",
   "lib/harness/grade.ts", 'const extra = actual.filter((a) => !required.some((r) => r.path === a.path));',
                       'const extra: Change[] = [];  // MUTATED', ALL),

  ("grading stops noticing changes that never happened",
   "lib/harness/grade.ts", '''  const missing = required.filter(
    (r) => !actual.some((a) => a.path === r.path && same(a.after, r.after)),
  );''', '  const missing: Change[] = [];  // MUTATED', ALL),

  ("opening a message no longer marks it read",
   "lib/environment/actions.ts", '''      email.read = true;
      next.selectedId = email.id;
      return { state: next, ok: true };
    }
    case "star":''', '''      next.selectedId = email.id;
      return { state: next, ok: true };  // MUTATED
    }
    case "star":''', ALL),

  ("send stops filing a copy in sent",
   "lib/environment/actions.ts", 'next.emails.push({', 'if (false) next.emails.push({  // MUTATED', ALL),

  # --- the grader judging wrong answers, not just right ones ---

  ('the label list collapses back into one value, hiding an extra label',
   'lib/environment/describe.ts', '      for (const label of email.labels) {\n        out.set(`${prefix}.labels.${label}`, true);\n      }',
                        '    out.set(`${prefix}.labels`, email.labels.join("|"));  // MUTATED', GRADING),

  ("labels stop being case-folded, so 'Finance' fails the triage task",
   'lib/environment/actions.ts', 'String(args.name ?? "").trim().toLowerCase()',
                        'String(args.name ?? "").trim()  /* MUTATED */', GRADING),

  ('ids go back to being counted from the array length',
   'lib/environment/actions.ts', '      let n = next.emails.length + 1;\n      while (next.emails.some((e) => e.id === `sent-${n}`)) n++;',
                        '      const n = next.emails.length + 1;  // MUTATED', MATRIX),

  ('reading a message the task is about counts against the agent again',
   'lib/harness/grade.ts', 'const required = requiredRaw.filter((c) => !isIncidental(env, c.path, touched));',
                        'const required = requiredRaw;  // MUTATED', GRADING),

  ('the email prefix is taken by stripping the last segment again',
   'lib/environment/describe.ts', '    const end = path.lastIndexOf(")");\n    return end === -1 ? path : path.slice(0, end + 1);',
                        '  return path.replace(/\\.[a-zA-Z]+$/, "");  // MUTATED', GRADING),

  ('a message can be starred without the grader noticing',
   'lib/environment/describe.ts', 'out.set(`${prefix}.starred`, email.starred);',
                        '// MUTATED', GRADING),


  # --- what survives leaving the process ---

  ('a restored mailbox no longer gets its missing fields filled in',
   'lib/environment/state.ts', 'query: typeof saved.query === "string" ? saved.query : "",',
                        'query: saved.query as string,  // MUTATED', PERSIST),

  ('a corrupt folder in storage is trusted instead of reset',
   'lib/environment/state.ts', 'folder: FOLDER_ORDER.includes(saved.folder as Folder) ? (saved.folder as Folder) : "inbox",',
                        'folder: (saved.folder ?? "inbox") as Folder,  // MUTATED', PERSIST),


  # --- the paths that spend the user's quota ---

  ('a spent quota exits like any other empty batch',
   'runner/run.ts', 'process.exit(stopKind === "quota" ? 3 : 1);',
                        'process.exit(1);  // MUTATED', QUOTA),

  ('the recording script stops reading the stop code',
   'record-runs.sh', 'elif [ "$RUN_STATUS" -eq 3 ]; then',
                        'elif [ "$RUN_STATUS" -eq 99 ]; then  # MUTATED', QUOTA),

  ('orphaned screenshots are left behind again when nothing is recorded',
   'runner/run.ts', '  await pruneShots(published);',
                        '  // MUTATED', QUOTA),


  # --- what CI does with nobody watching ---

  ('a scheduled job starts spending the quota again',
   '../.github/workflows/agent-runs.yml', 'on:\n  workflow_dispatch:',
                        'on:\n  schedule:\n    - cron: "0 4 * * 0"  # MUTATED\n  workflow_dispatch:', FLOW),

  ('a recording batch drops --append and replaces every other run',
   '../.github/workflows/agent-runs.yml', '--all --append --mode',
                        '--all --mode  # MUTATED', FLOW),

  ('CI is allowed to authorise spending',
   '../.github/workflows/agent-runs.yml', 'BUDGET: "0"',
                        'BUDGET: "5"  # MUTATED', FLOW),

  ('the browser is installed through npx again',
   '../.github/workflows/agent-runs.yml', './web/runner/node_modules/.bin/playwright install --with-deps chromium',
                        'npx --prefix runner playwright install --with-deps chromium  # MUTATED', FLOW),

  ('the gym check passes when the environment is unreachable',
   '../.github/workflows/agent-runs.yml',
   'if ! curl -sSf -o /dev/null --max-time 20 "${GYM_URL}"; then',
   'if false; then  # MUTATED', FLOW),

  ('CI stops running the mutation checks',
   '../.github/workflows/ci.yml', 'python3 tools/loop-mutation-check.py',
                        '# MUTATED', FLOW),

  ('the runner goes back to being unchecked',
   '../.github/workflows/ci.yml', '- run: npm run typecheck:runner',
                        '# MUTATED', FLOW),

  ('a push races whatever landed on main during the run',
   '../.github/workflows/agent-runs.yml', '          git pull --rebase --autostash\n',
                        '  # MUTATED\n', FLOW),

  ('--mode silently accepts a typo and records the wrong action space',
   'runner/run.ts', 'if (requestedMode !== "tool" && requestedMode !== "computer") {',
                        'if (false) {  // MUTATED', CLI),


  # --- who may spend the key ---


  # --- production holds no key, so there is nothing to spend ---

  ('the deployment verifier stops probing the routes that used to exist',
   'verify-deployment.sh', 'GONE="/api/agent /api/session /api/models"',
                        'GONE=""  # MUTATED', DEPLOY),

  ('the verifier treats a live API route as acceptable',
   'verify-deployment.sh',
   '      2*)      bad "$path ANSWERED ($C). Something is deployed that can spend a key." ;;',
                        '      2*)      ok "$path answered"  # MUTATED', DEPLOY),


  # --- the budget the model is measured against ---

  ('the turn budget stops depending on the action space',
   'lib/harness/tasks.ts', '  return task.maxTurns[mode];',
                        '  return task.maxTurns.tool;  // MUTATED', BUDGET),

  ('computer use is put back on the tool-calling budget',
   'lib/harness/tasks.ts', '    maxTurns: { tool: 12, computer: 26 },',
                        '    maxTurns: { tool: 12, computer: 12 },  // MUTATED', BUDGET),

  ('typing into a field is costed as a single interaction',
   'lib/environment/catalog.ts', '    effect: "Adds a label, lower-cased. Implies opening.",\n    clicks: 3,',
                        '    effect: "Adds a label, lower-cased. Implies opening.",\n    clicks: 1,  // MUTATED', BUDGET),

  ('the runner reads the budget without saying which space it is running',
   'runner/run.ts', 'const maxTurns = TURN_OVERRIDE ?? turnsFor(task, mode);',
                        'const maxTurns = TURN_OVERRIDE ?? task.maxTurns.tool;  // MUTATED', BUDGET),


  # --- affordances the budget assumes exist ---


  # --- the seam between the harness and the application ---

  ('the grader reaches back into the application it is grading',
   'lib/harness/grade.ts', 'export const ANY',
                        'import type { MailState } from "../gym/state.ts";  // MUTATED\nexport const ANY', SEAM),

  ('the adapter starts deciding verdicts instead of describing',
   'lib/environment/describe.ts', 'import type { Describable } from "../harness/grade.ts";',
                        'import type { Describable, Status } from "../harness/grade.ts";  // MUTATED', SEAM),

  ("volatile paths stop being the environment's own",
   'lib/environment/describe.ts', 'volatile: [/\\.id$/, /\\.receivedAt$/, /^selectedId$/, /^query$/],',
                        'volatile: [],  // MUTATED', SEAM),

  ('the environment stops naming which object a path belongs to',
   'lib/environment/describe.ts', '    const end = path.lastIndexOf(")");',
                        '    const end = -1;  // MUTATED', SEAM),


  # --- the gym and the harness are separate things ---

  ("the harness reads the application's storage instead of its contract",
   'runner/driver.ts', 'const state = await page.evaluate(() => window.clickmail!.state());',
                        'const state = JSON.parse(await page.evaluate(() => window.localStorage.getItem("clickmail.mail.v1")) ?? "null");  // MUTATED', SPLIT),

  ('the run stops fetching the world before the task starts',
   'runner/run.ts', '    initial = await begin(page);',
                        '    initial = offlineSeed();  // MUTATED', SPLIT),

  ('a task carries its own copy of the starting world again',
   'lib/harness/tasks.ts', '  expected: (initial: MailState) => MailState;',
                        '  expected: (initial: MailState) => MailState;\n  seed?: MailState;  // MUTATED', SPLIT),

  ('the console gains a way to write runs from the browser',
   'hooks/use-runs.ts', '    const measured = published.length ? published : SEEDED_RUNS;',
                        '    window.localStorage.setItem("runs", "1");  // MUTATED\n    const measured = published.length ? published : SEEDED_RUNS;', SPLIT),


  # --- the agent has to land on the page that publishes the contract ---

  ('the runner stops correcting a bare origin, so it lands on the landing page',
   'runner/run.ts', '  if (!path.endsWith("/gym")) url.pathname = `${path}/gym`;',
                        '  // MUTATED', SPLIT),

  ('the default target stops being the deployed environment',
   'lib/environment/contract.ts',
   'export const GYM_HOME = "https://clickmail-sigma.vercel.app/gym";',
   'export const GYM_HOME = "http://localhost:3000/gym";  // MUTATED', SPLIT),

  ('the shared address stops being absolute, so it resolves against this origin',
   'lib/environment/contract.ts',
   'export const GYM_HOME = "https://clickmail-sigma.vercel.app/gym";',
   'export const GYM_HOME = "/gym";  // MUTATED', SPLIT),

  ('the interface links the environment as one of its own routes again',
   'components/app-shell.tsx', '<a href={GYM_HOME} target="_blank" rel="noreferrer">',
                        '<a href="/gym" target="_blank" rel="noreferrer">  {/* MUTATED */}', SPLIT),

  # --- the verdict has to be checkable, not just stated ---

  ('the run detail stops showing the comparison behind the verdict',
   'app/runs/[id]/page.tsx', '<StateComparison run={run} />',
                        '{/* MUTATED */}', LAYOUT),

  ('the comparison stops marking which required changes never happened',
   'components/harness/state-comparison.tsx', '  const missing = new Set(grade.missing.map((c) => c.path));',
                        '  const missing = new Set<string>();  // MUTATED', LAYOUT),

  ('an unscored run is drawn as an empty comparison instead of an absent one',
   'components/harness/state-comparison.tsx', '  if (!grade) {',
                        '  if (false) {  // MUTATED', LAYOUT),


  # --- a preflight tick that cannot fail ---

  ('the app install is reported green without anything being installed',
   'record-runs.sh', '[ -f node_modules/next/package.json ] \\\n  || die',
                        '# MUTATED', QUOTA),

  ('the Chromium tick goes back outside the branch that earned it',
   'record-runs.sh', 'if ./runner/node_modules/.bin/playwright install chromium >/dev/null 2>&1; then\n  ok "Chromium"\nelse',
                        'if ! ./runner/node_modules/.bin/playwright install chromium >/dev/null 2>&1; then\n  ok "Chromium"  # MUTATED\nelse', QUOTA),


  # --- the coordinate space, which is the one that silently costs money ---

  ('the grid reading stops being offered, so an undecided point reads as settled',
   'lib/environment/computer.ts',
   '    ambiguous: !assume && plausible.length > 0,',
   '    ambiguous: false,  // MUTATED', COORDS),

  ('the runner stops settling the space against the page',
   'runner/run.ts', '          const verdict = await calibrate(page, alone, alone.alternate);',
   '          const verdict = null;  // MUTATED', COORDS),

  ('the settled space is not applied to the turns after it',
   'runner/run.ts', '            ? resolvePoint(x, y, VIEWPORT, convention ?? undefined)',
   '            ? resolvePoint(x, y, VIEWPORT)  // MUTATED', COORDS),

  ('calibration commits to an answer the page never gave',
   'runner/driver.ts', '  if (hit(here) === hit(there)) return null;',
   '  // MUTATED', COORDS),

  ('any element counts as a hit, so both readings always land on something',
   'runner/driver.ts', '  const hit = (what: string) => what !== "nothing" && !GENERIC.has(what);',
   '  const hit = (what: string) => what !== "nothing";  // MUTATED', COORDS),

  ('the timeline stops showing where the click actually went',
   'components/harness/timeline.tsx', '                      {aimOf(entry) && (',
   '                      {false && (  {/* MUTATED */}', LAYOUT),

  # --- what actually reaches the deployment ---

  ('an ignore pattern goes back to matching at any depth, swallowing a route',
   '.vercelignore', '\n/tests/\n/tools/\n', '\n/tests/\ntools/  # MUTATED\n', DEPLOY),

  ('the runner exclusion loses its anchor',
   '.vercelignore', '/runner/', 'runner/  # MUTATED', DEPLOY),


  # --- what a 429 means depends on who is paying ---

  ('a paid 429 ends the whole session again, as if the pool were shared',
   'runner/run.ts', '        if (PAID && !throttled) {', '        if (false) {  // MUTATED', QUOTA),

  ('the retry on a paid 429 stops being bounded to one attempt',
   'runner/run.ts', '          throttled = true;', '          // MUTATED', QUOTA),

  ('a sentinel rate limit is printed as though it were a measurement',
   'runner/run.ts', '  if ((data.rate_limit?.requests ?? 0) > 0 && data.rate_limit?.interval) {',
   '  if (data.rate_limit?.requests && data.rate_limit.interval) {  // MUTATED', QUOTA),


  ('a paid run stops saying what it can actually cost',
   'runner/run.ts', '        projected = reply.cost * maxTurns;', '        projected = 0;  // MUTATED', QUOTA),

  ('a budget far above anything reachable is no longer called out',
   'runner/run.ts', '        if (projected < BUDGET / 4) {', '        if (false) {  // MUTATED', QUOTA),


  ('a reading only one space can explain stops settling that space',
   'lib/environment/computer.ts', '    decisive: !assume && plausible.length === 0 && ruledOut,',
   '    decisive: false,  // MUTATED', COORDS),

  ('agreement between readings counts as evidence again',
   'lib/environment/computer.ts', '    .some((other) => !inImage(other.imageX, other.imageY));',
   '    .length > 0;  // MUTATED', COORDS),

  ('the runner stops settling from the numbers and waits for the page',
   'runner/run.ts', '        if (alone?.decisive && alone.convention !== convention) {',
   '        if (false) {  // MUTATED', COORDS),


  ('gemini stops being known to answer on a 0-1000 grid',
   'lib/environment/computer.ts', '{ match: /gemini/i, convention: "grid1000" },',
   '{ match: /gemini/i, convention: "pixels" },  // MUTATED', COORDS),

  ('the gemini rule widens back to every google model, catching text-only ones',
   'lib/environment/computer.ts', '{ match: /gemini/i, convention: "grid1000" },',
   '{ match: /(^|\\/)google\\/|gemini/i, convention: "grid1000" },  // MUTATED', COORDS),

  ('the runner reads the vendored spec in the wrong coordinate space',
   'tests/conformance.test.ts', '  normalized_1000: "grid1000",',
   '  normalized_1000: "pixels",  // MUTATED', CONFORM),

  ('the runner drifts from the spec it publishes conformance with',
   'lib/environment/computer.ts', '      return { convention, imageX: (rawX / 1000) * iw, imageY: (rawY / 1000) * ih };',
   '      return { convention, imageX: (rawX / 1024) * iw, imageY: (rawY / 1024) * ih };  // MUTATED', COORDS + CONFORM),

  ('the declaration is looked up from the model asked for, not the one that answered',
   'runner/run.ts', 'const declared = declaredConvention(reply.model);',
   'const declared = declaredConvention(MODEL);  // MUTATED', COORDS),

  ('a coordinate can no longer contradict what the provider documents',
   'runner/run.ts', '        const alone: Resolved | null = read\n          ? resolvePoint(read.raw.x, read.raw.y, VIEWPORT)\n          : null;',
   '        const alone: Resolved | null = read;  // MUTATED', COORDS),


  # --- a run has to be readable, not just recorded ---

  ('an action stops carrying the screen it was decided from',
   'runner/run.ts', '        screenshotBefore: before,', '        // MUTATED', LAYOUT),

  ('the timeline stops distinguishing what was seen from what was done',
   'components/harness/timeline.tsx', 'label="saw"', 'label="did"', LAYOUT),

  ('a tool-calling turn is recorded as an empty reply again',
   'runner/run.ts', '        text:\n          reply.content ||',
   '        text: reply.content,  // MUTATED', LAYOUT),

  ('the no-thought placeholder prints over a turn that reasoned',
   'components/harness/timeline.tsx', '{(entry.text || !entry.reasoning) && (',
   '{true && (  {/* MUTATED */}', LAYOUT),


  ('the aim goes back on the result instead of the screen it was decided from',
   'components/harness/browser-view.tsx', '        ? { src: action.screenshot, aimed: !action.screenshotBefore }',
   '        ? { src: action.screenshot, aimed: true }  // MUTATED', LAYOUT),

  ('the environment pane stops opening on the screen the model was given',
   'components/harness/browser-view.tsx', 'useState<"saw" | "did">("saw")',
   'useState<"saw" | "did">("did")  // MUTATED', LAYOUT),


  ('tool-mode runs go back to being recorded with no screen at all',
   'runner/run.ts', '    let frame: Frame | null = start;',
   '    let frame: Frame | null = mode === "computer" ? start : null;  // MUTATED', LAYOUT),

  ('the capture stops waiting for the repaint, so every frame is the one before',
   'runner/run.ts', '      await page.waitForTimeout(180);\n      const before = frame?.path;',
   '      const before = frame?.path;  // MUTATED', LAYOUT),


  ('the recorder goes back to reading only its first argument',
   'record-runs.sh', 'for arg in "$@"; do', 'for arg in "$1"; do  # MUTATED', CLI),

  ('a list of tasks is filtered by equality, so only the last one runs',
   'record-runs.sh', '      *" $TASK_ID "*) : ;;', '      "$ONLY") : ;;  # MUTATED', CLI),

  ('a short task id matches inside a longer one',
   'record-runs.sh', '    case " $ONLY " in', '    case "$ONLY" in  # MUTATED', CLI),


  ('a task stops requiring any change, so every run passes it including one that did nothing',
   'lib/harness/tasks.ts', '    expected: (initial) => change(initial, (state) => {\n      const invoice = at(state, "m1");\n      invoice.starred = true;',
   '    expected: (initial) => change(initial, (state) => {\n      if (state) return;  // MUTATED\n      const invoice = at(state, "m1");\n      invoice.starred = true;', ['tests/solvable.test.ts']),

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
# the suite was green to begin with — and for a long time it was not: both these
# tools ran a test file that had been deleted, node exited non-zero because the
# path did not resolve, and every single case reported CAUGHT without a mutation
# ever being applied. Two of the guards behind that were, in fact, guarding
# nothing.
#
# So each distinct test list is run once, unmutated, before anything is edited.
# A list that is already red proves nothing about any mutation that uses it, and
# says so.

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


# Paths are relative to `web/`, which is where this tool runs. The workflows are
# one level up, at the top of the repository — they used to be addressed without
# the `../` and matched a stale copy inside `web/` that GitHub never ran, so
# eight cases about spending money were mutating a file with no effect on
# anything. They now skip loudly if the path is wrong, which is how that was
# found.
def refuse_if_already_mutated(paths):
    """Refuse to start on a tree that still carries a mutation.

    Every marker this tool writes is removed on exit, on SIGINT, SIGTERM and
    SIGHUP. It cannot be removed on SIGKILL, and a hard timeout kills rather
    than signals — which is exactly how a run of this tool once left
    `// MUTATED` in a source file, where it sat until the next test run failed
    for a reason nobody could place.

    So the first thing it does is look. A marker already in the tree means the
    last run died without cleaning up, and mutating on top of that would edit a
    file whose "original" is already wrong — turning a lost cleanup into a
    corrupted source file.
    """
    dirty = [p for p in dict.fromkeys(paths)
             if pathlib.Path(p).exists() and "// MUTATED" in pathlib.Path(p).read_text()]
    if dirty:
        print("\nREFUSING TO START — a previous run left a mutation behind:\n")
        for path in dirty:
            print(f"    {path}")
        print("\nRestore them (`git checkout -- <path>`) and run this again.\n")
        sys.exit(2)


refuse_if_already_mutated([case[1] for case in CASES])

results = []
for name, rel, old, new, tests in CASES:
    path = pathlib.Path(rel)
    # A moved or renamed file is a gap in the checks, not a crash. Before this,
    # relocating a source file made the whole tool die on the first case and
    # report nothing about the fifty that still worked.
    if not path.exists():
        results.append((name, f"SKIP - {rel} does not exist"))
        continue
    original = _stash(path)
    if old not in original:
        results.append((name, "SKIP - anchor not found"))
        continue
    if not baseline_ok(tests):
        results.append((name, "*** BASELINE RED - proves nothing ***"))
        continue
    path.write_text(original.replace(old, new, 1), encoding="utf-8")
    try:
        r = subprocess.run(["node", "--test", "--experimental-strip-types", *tests],
                           capture_output=True, text=True)
    finally:
        path.write_text(original, encoding="utf-8")
        _ORIGINALS.pop(str(path), None)
    results.append((name, "CAUGHT" if r.returncode != 0 else "*** NOT CAUGHT ***"))

print(f"\n{'mutation':<62} {'result'}")
print("-" * 88)
for name, verdict in results:
    print(f"{name:<62} {verdict}")
gaps = [n for n, v in results if v != "CAUGHT"]
print()
print("all mutations caught" if not gaps else f"GAPS: {len(gaps)}")
sys.exit(1 if gaps else 0)
