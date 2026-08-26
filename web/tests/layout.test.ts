import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

/**
 * Guards on the two layout defects that made a run unreadable.
 *
 * Both are the kind that come back: the first is undone by regenerating a
 * shadcn component from the registry, the second by anyone deciding the verdict
 * deserves a panel of its own again.
 */

test("every route names itself in the browser tab", () => {
  // The layout sets `title: { default: "agentscore", template: "%s — agentscore" }`,
  // and a `"use client"` page cannot export `metadata`, so the template never
  // fired: four of the seven tabs read "agentscore" and nothing else. Each
  // console now sits behind a server `page.tsx` that owns the title.
  //
  // The root is exempt: a home page whose tab reads "agentscore" is correct.
  const pages = readdirSync(path.join(ROOT, "app"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === "page.tsx")
    .map((e) => path.relative(path.join(ROOT, "app"), path.join(e.parentPath, e.name)));

  const untitled = pages
    .filter((relative) => relative !== "page.tsx")
    .filter((relative) => !/export const metadata/.test(read(path.join("app", relative))));

  assert.deepEqual(untitled, [], "these routes fall back to the bare site title");
});

test("the scroll viewport is forced to a block, so long lines wrap", () => {
  // Radix renders the viewport's inner wrapper as `display: table`, which
  // shrink-wraps to its content. Prose then never wraps — it runs past the edge
  // and is clipped, which is exactly how the timeline was truncating.
  const source = read("components/ui/scroll-area.tsx");

  assert.match(source, /\[&>div\]:!block/, "the table display has to be overridden");
  assert.match(source, /\[&>div\]:!w-full/, "and clamped to the viewport width");
});

test("timeline text is allowed to break rather than overflow", () => {
  const source = read("components/harness/timeline.tsx");

  assert.match(source, /leading-relaxed break-words/, "the thought must wrap");
  assert.match(source, /whitespace-pre-wrap break-all/, "the raw reply must wrap too");
});

test("the trajectory gets the full width, not half of it", () => {
  // The verdict is a two-line answer; the trajectory is the thing being read.
  // Giving them equal width squeezed the one that mattered.
  const detail = read("app/runs/[id]/run-detail.tsx");

  assert.ok(
    !/lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.2fr\)\]/.test(detail),
    "the side-by-side grading pane must not come back",
  );
  assert.match(detail, /<GradingDialog/, "the verdict opens on demand instead");
});

test("every verdict has one name, one icon and one explanation", () => {
  // Three components used to hold their own copies and had drifted: the same
  // outcome read as "Both", "Incomplete and overreached" and "Incomplete, and
  // did more than it was asked" depending on where you saw it.
  const meta = read("lib/harness/verdict-meta.ts");

  for (const status of ["pass", "incomplete", "overreach", "both", "unscored"]) {
    assert.ok(meta.includes(`${status}: {`), `${status} needs a presentation`);
  }

  // A run that never reached a model is not a failure and must not wear a cross.
  assert.match(meta, /unscored: \{[\s\S]*?CircleSlash/);

  // "Both" names a relationship to two things the reader cannot see. Every
  // label here has to survive being read on its own.
  assert.ok(!/short: "Both"/.test(meta), '"Both" is not a label');
  assert.match(meta, /Missed some, and did more than asked/);

  for (const file of [
    "components/harness/verdict-badge.tsx",
    "components/harness/grading-dialog.tsx",
    "components/harness/space-comparison.tsx",
  ]) {
    assert.match(read(file), /verdict-meta/, `${file} must use the shared table`);
  }
});

/* -------------------------------------------------------------------- */
/* Overflow: the same defect in four places                              */
/* -------------------------------------------------------------------- */

test("the dialog lets its children shrink below their content", () => {
  // DialogContent is a grid, and a grid item defaults to min-width:auto — it
  // refuses to shrink below its content. One long unbreakable string then
  // widens the whole dialog past max-w-*, and everything is clipped at the real
  // edge, where no ellipsis appears to explain it.
  const source = read("components/ui/dialog.tsx");

  assert.match(source, /\[&>\*\]:min-w-0/, "grid children must be allowed to shrink");
  assert.match(
    source,
    /overflow-x-hidden/,
    "and the x axis is pinned explicitly, not left to stylesheet order",
  );
});

test("grading paths wrap instead of pretending to truncate", () => {
  const source = read("components/harness/change-list.tsx");

  // `truncate` sets white-space:nowrap, so the element demands its full content
  // width. In an unconstrained parent it widens the container rather than
  // ellipsising — the truncation never happens and the clipping moves outward.
  assert.ok(
    !/block truncate font-mono/.test(source),
    "truncate on an unconstrained parent does not truncate",
  );
  assert.match(source, /block break-all font-mono/);
});

/* -------------------------------------------------------------------- */
/* What a viewer sees                                                    */
/* -------------------------------------------------------------------- */

test("the console reads the committed file and nothing else", () => {
  /*
   * The console is static. It holds no key, cannot reach a model, and has no
   * way to record anything — so `public/runs/index.json` is the only evidence
   * it can show, and every visitor sees the same set.
   *
   * This used to be about keeping a signed-in owner's local runs off a public
   * page. There is no owner and no local storage now; the property is stronger
   * and the test says so.
   */
  const source = read("hooks/use-runs.ts");

  assert.match(source, /loadPublished/, "the committed file must be the source");
  assert.ok(!/localStorage|saveRun|deleteRun/.test(source), "the console is storing runs again");
  assert.match(source, /SEEDED_RUNS/, "samples should still fill an empty console");
});

test("seeded samples retire once real runs are published", () => {
  const source = read("hooks/use-runs.ts");

  // A fabricated row beside measured ones, separated only by a badge, invites
  // exactly the confusion the badge exists to prevent.
  assert.match(source, /published\.length \? published : SEEDED_RUNS/);
});

test("a run shows the comparison its verdict was computed from", () => {
  // The record has carried both snapshots for a while and the page showed
  // neither, so the reader got a word — "Incomplete" — and no way to check it.
  // A benchmark that grades on final state and never displays the state is
  // asking to be taken on faith.
  // The usage, not the import. An import left behind by a deleted element is
  // exactly the shape this assertion has to survive — it matched the import
  // line and reported the guard green with the panel gone from the page.
  const detail = read("app/runs/[id]/run-detail.tsx");
  assert.match(
    detail,
    /<StateComparison\s+run=\{run\}\s*\/>/,
    "the run detail no longer renders the state comparison",
  );

  const panel = read("components/harness/state-comparison.tsx");
  assert.match(panel, /grade\.required/, "the required changes are not rendered");
  assert.match(panel, /grade\.extra/, "the unrequested changes are not rendered");
  assert.match(panel, /grade\.missing/, "nothing marks a required change as missing");
  assert.match(panel, /run\.snapshots/, "the snapshot pair is not rendered");
});

test("an unscored run says so rather than showing an empty comparison", () => {
  // A run that never reached a model has no verdict. Rendering it as "nothing
  // was required and nothing changed" would read as a pass.
  const panel = read("components/harness/state-comparison.tsx");
  assert.match(panel, /if \(!grade\)/, "a missing verdict is not handled separately");
  assert.match(panel, /absent measurement/, "an unscored run is not explained as one");
});

test("a wide snapshot scrolls inside itself, not the page", () => {
  // A JSON dump is the widest thing on the page by a distance. Without its own
  // scroll container the body scrolls sideways, which breaks the layout of
  // every other element at once.
  const panel = read("components/harness/state-comparison.tsx");
  assert.match(panel, /overflow-auto/, "the snapshot pane has no scroll container");
});

test("a computer-use action shows where the click actually went", () => {
  // The same pair of numbers is a legal pixel coordinate and a legal 0-1000
  // grid coordinate, so the conversion is the difference between "the model
  // missed" and "we converted it wrongly". It was recorded on every action and
  // rendered on none of them, which left the timeline unable to answer the one
  // question a computer-use run is read to answer.
  const timeline = read("components/harness/timeline.tsx");

  // The guard, not just the call. Asserting on the name alone matched the
  // render inside the guard, so switching the guard off left the assertion
  // passing with nothing on screen.
  assert.match(timeline, /\{aimOf\(entry\) && \(/, "the conversion is not rendered");
  assert.match(timeline, /metadata\?\.point/, "the point metadata is not read");
  assert.match(timeline, /space settled as/, "a calibrated turn does not say so");
  // Untyped metadata: every field checked, none asserted. A run recorded before
  // this was captured has no aim and must render without one.
  assert.match(timeline, /typeof label !== "string"/, "a missing label would throw rather than skip");
});

test("an action shows the screen it was decided from, not only the one it produced", () => {
  /*
   * One screenshot per action made a run unreadable in a specific way. An
   * archive click shows an empty reading pane afterwards — the correct result,
   * and indistinguishable from a click that hit nothing. The frame the model
   * was actually looking at when it chose was never on the page at all, so
   * "did it see the button" could not be answered from the record.
   */
  //
  // The pair lives in the browser pane. The timeline used to carry a second
  // copy of it behind a `compact` flag both call sites always set, so the
  // guard was reading a branch that never rendered; it now reads the one that
  // does.
  const view = read("components/harness/browser-view.tsx");

  assert.match(view, /action\.screenshotBefore/, "the frame behind the decision is not rendered");
  assert.match(view, /"saw", "the screen the model was given"/, "the frames are not distinguishable");
  assert.match(view, /"did", "what the action produced"/, "the frames are not distinguishable");
});

test("a turn that answered with a tool call does not read as an empty one", () => {
  /*
   * A tool call comes back with empty message content. The reply pane printed
   * "(empty)" and the reasoning pane printed "no thought returned" — on every
   * turn of a run that worked perfectly. Two placeholders reporting success as
   * failure.
   */
  const timeline = read("components/harness/timeline.tsx");
  const runner = read("runner/run.ts");

  assert.match(
    timeline,
    /\(entry\.text \|\| !entry\.reasoning\) && \(/,
    "the no-thought placeholder still prints over a turn that reasoned",
  );
  assert.match(
    runner,
    /reply\.content \|\|\n?\s*\(reply\.toolCall/,
    "the recorded reply is empty whenever the model used a tool",
  );
});

test("one capture serves the record and the next prompt", () => {
  // Two captures of the same moment is wasted work and a way for the file and
  // the frame the model saw to disagree if anything repainted between them.
  const runner = read("runner/run.ts");

  assert.match(runner, /interface Frame \{/, "the frame is not modelled as one thing");
  assert.ok(
    !/photograph\(page\)/.test(runner),
    "the runner captures a second time for the model instead of reusing the frame",
  );
  assert.match(
    runner,
    /const before = frame\?\.path;/,
    "the previous frame is not reused as this action's before",
  );
  // Captured and then actually written onto the entry. Taking the frame and
  // dropping it leaves the timeline reading a field nothing records.
  assert.match(
    runner,
    /screenshotBefore: before,/,
    "the frame behind the decision is captured and then thrown away",
  );
});

test("the aim is drawn on the screen the model was looking at", () => {
  /*
   * The defect this exists for, and it made the pane's stated purpose
   * impossible rather than merely incomplete.
   *
   * The environment pane says it answers "was the decision wrong or was the aim
   * wrong?" It had one frame — the one taken after the action — and drew the
   * crosshair on it. An aim is a claim about the screen the model was given, so
   * painted on the result it points at whatever now happens to sit under those
   * coordinates. Archive a message and the reading pane empties: the marker
   * lands on a toolbar that is gone, above the words "Select a message", and
   * reads as a model clicking into space. The opposite of what happened.
   */
  const view = read("components/harness/browser-view.tsx");

  // Two frames, one at a time, switchable — opening on the one behind the
  // decision, because that is the frame a question is usually being asked about.
  assert.match(view, /useState<"saw"/, "the pane has no frame toggle");
  assert.match(view, /\("saw"\)/, "the pane does not open on the frame behind the decision");

  // The marker rides `aimed`, true only for the frame the model saw — or for
  // the result of an older run that has no other frame to carry it.
  assert.match(view, /frame\.aimed && onScreen/, "the aim is drawn on whichever frame is showing");
  assert.match(
    view,
    /aimed: !action\.screenshotBefore/,
    "the result carries an aim marker even when the frame it belongs on exists",
  );
});

test("both action spaces are recorded on screen, not just the one shown pictures", () => {
  /*
   * Capture was gated on computer use, because a screenshot was something the
   * *model* was given and tool calling is handed serialised state instead. That
   * missed the second job a screenshot does: it is how a person reads the run
   * back. Chromium drives the real page in both spaces through the same driver,
   * so a tool-mode run was performed in a real browser and recorded as though
   * nothing had been on screen — the run page went blank, and the comparison
   * the whole project exists for had a record on one side only.
   */
  const runner = read("runner/run.ts");

  assert.ok(
    !/mode === "computer" \? start : null/.test(runner),
    "tool-mode runs are recorded with no screen at all",
  );
  // The picture is taken in both spaces; only the data URL is mode-specific.
  assert.match(
    runner,
    /await page\.waitForTimeout\(180\);\n\s*const before = frame\?\.path;/,
    "the settle before the capture is not shared, so one space photographs a stale screen",
  );
  assert.match(
    runner,
    /image_url: \{ url: frame\?\.dataUrl/,
    "the inline image is no longer what computer use is actually sent",
  );
});

test("the action-space page explains how a turn is actually sent", () => {
  // The page described what each space *shows* the model and never how a turn
  // travels. Once both spaces went through real tool calling that became the
  // more interesting half: it is what makes the two comparable, and it is where
  // the honest limitation lives.
  const page = read("app/tools/page.tsx");

  assert.match(page, /How a turn is sent/, "the transport is not described");
  assert.match(page, /tool_call_id/, "the loop's pairing is not explained");
  assert.match(
    page,
    /not a provider-native computer-use tool/i,
    "the page lets a reader assume this is Anthropic's or OpenAI's computer tool",
  );
});
