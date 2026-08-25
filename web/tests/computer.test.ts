import { SYSTEM_PROMPT } from "../lib/environment/serialize.ts";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  COMPUTER_ACTIONS,
  SCREEN,
  computerPrompt,
  computerToolSchemas,
  declaredConvention,
  describeResolution,
  resolvePoint,
  type Viewport,
} from "../lib/environment/computer.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// A 1180x720 environment photographed at half scale, which is what the gym does.
const VIEW: Viewport = { width: 1180, height: 720, imageWidth: 590, imageHeight: 360 };

test("pixel coordinates scale from image space to CSS pixels", () => {
  const point = resolvePoint(295, 180, VIEW);

  assert.equal(point.convention, "pixels");
  assert.equal(point.x, 590);
  assert.equal(point.y, 360);
  assert.equal(point.outOfBounds, false);
});

test("a 0-1000 grid answer is recognised and rescaled", () => {
  // 800 overshoots the 590px image, so it cannot be image pixels.
  const point = resolvePoint(800, 500, VIEW);

  assert.equal(point.convention, "grid1000");
  assert.equal(Math.round(point.x), Math.round(0.8 * 1180));
  assert.equal(Math.round(point.y), Math.round(0.5 * 720));
});

test("a fractional answer is recognised", () => {
  const point = resolvePoint(0.25, 0.5, VIEW);

  assert.equal(point.convention, "fraction");
  assert.equal(point.x, 295);
  assert.equal(point.y, 360);
});

test("whole numbers inside the unit range stay pixels", () => {
  // A model aiming at the very corner means the corner, not the whole screen.
  const origin = resolvePoint(0, 0, VIEW);
  assert.equal(origin.convention, "pixels");
  assert.equal(origin.x, 0);

  const one = resolvePoint(1, 1, VIEW);
  assert.equal(one.convention, "pixels");
  assert.equal(Math.round(one.x), 2);
});

test("a point past the image is reported out of bounds rather than clamped", () => {
  // 2000 exceeds the 1000 grid too, so it is read as pixels and is simply wrong.
  const point = resolvePoint(2000, 100, VIEW);

  assert.equal(point.convention, "pixels");
  assert.equal(point.outOfBounds, true);
});

test("a negative coordinate is out of bounds", () => {
  assert.equal(resolvePoint(-5, 100, VIEW).outOfBounds, true);
});

test("the raw numbers survive the conversion", () => {
  const point = resolvePoint(800, 500, VIEW);

  assert.deepEqual(point.raw, { x: 800, y: 500 });
});

test("the timeline label shows the conversion when there was one", () => {
  assert.match(describeResolution(resolvePoint(800, 500, VIEW)), /0-1000 grid → /);
  assert.match(describeResolution(resolvePoint(0.25, 0.5, VIEW)), /fraction → /);
});

test("a straight pixel answer is not dressed up as a conversion", () => {
  // 590 image px doubles to 1180 CSS px, so this one does show an arrow. The
  // no-arrow case is a point where image and CSS pixels coincide.
  const flat: Viewport = { width: 590, height: 360, imageWidth: 590, imageHeight: 360 };
  assert.equal(describeResolution(resolvePoint(120, 200, flat)), "(120, 200) px");
});

test("scale errors are caught: half-scale image, full-scale environment", () => {
  // The regression this guards: forgetting the image/CSS ratio puts every click
  // in the top-left quadrant, which reads exactly like a model that cannot aim.
  const bottomRight = resolvePoint(VIEW.imageWidth, VIEW.imageHeight, VIEW);

  assert.equal(bottomRight.x, VIEW.width);
  assert.equal(bottomRight.y, VIEW.height);
});

test("the prompt asks for a tool call, not for JSON in the message", () => {
  const prompt = computerPrompt(VIEW);

  /*
   * What this replaced, and why the old assertion is gone rather than relaxed.
   *
   * The prompt used to describe an action vocabulary in prose, ask for a JSON
   * object back in the message text, and warn the model to keep its thought
   * under 25 words — because a long thought hit the output cap, the reply
   * arrived as `{"thought": "…", "acti`, and the run recorded a parse failure
   * that looked like a model unable to follow a format. The warning was a
   * workaround for a problem the transport was creating.
   *
   * Tools remove it at the source: the provider emits a structured call and
   * validates its arguments against the schema. There is no object for the
   * model to truncate, so there is nothing to warn it about.
   */
  assert.match(prompt, /tools you have been given/i, "the prompt does not ask for a tool call");
  assert.ok(!/JSON object/i.test(prompt), "the prompt still asks for JSON in the message text");
  assert.ok(!/under 25 words/.test(prompt), "the thought cap outlived the problem it worked around");
});

test("every computer action is offered as a schema the provider can validate", () => {
  const schemas = computerToolSchemas();

  assert.equal(schemas.length, COMPUTER_ACTIONS.length, "an action has no schema");
  for (const action of COMPUTER_ACTIONS) {
    const schema = schemas.find((t) => t.function.name === action.name);
    assert.ok(schema, `${action.name} is not offered as a tool`);
    assert.equal(schema.function.parameters.additionalProperties, false);

    const required = schema.function.parameters.required;
    for (const param of action.params) {
      assert.ok(
        param.name in schema.function.parameters.properties,
        `${action.name} does not declare ${param.name}`,
      );
      assert.equal(
        required.includes(param.name),
        !param.optional,
        `${action.name}.${param.name} disagrees about being required`,
      );
    }
  }
});

test("a click asks for two numbers, so a model cannot answer with a string", () => {
  // The whole point of a schema over a prompt: the provider rejects the wrong
  // shape before it costs a turn.
  const click = computerToolSchemas().find((t) => t.function.name === "click");
  assert.ok(click);
  assert.equal(click.function.parameters.properties.x.type, "number");
  assert.equal(click.function.parameters.properties.y.type, "number");
  assert.deepEqual(click.function.parameters.required, ["x", "y"]);
});

test("the prompt states the image size the model must answer in", () => {
  const prompt = computerPrompt(VIEW);

  assert.ok(
    prompt.includes(`${VIEW.imageWidth} by ${VIEW.imageHeight}`),
    "the model cannot pick a coordinate space it was not told about",
  );
});

test("the output ceiling leaves room for reasoning tokens as well as the reply", () => {
  /*
   * Reasoning tokens count against max_tokens, so a ceiling sized for the JSON
   * alone truncates the answer and the turn is paid for and wasted. One caller
   * now — the console is static and holds no key — so this is the runner's.
   */
  const source = readFileSync(path.join(import.meta.dirname, "..", "runner/run.ts"), "utf8");
  const ceilings = [...source.matchAll(/mode === "computer" \? (\d+) : (\d+)/g)][0];

  assert.ok(ceilings, "the runner sends no output ceiling");

  // Both spaces, because the cheap one was the one left too low: a short reply
  // still has to be written after the model has finished thinking, and thinking
  // is drawn from the same allowance.
  for (const [space, limit] of [["computer use", ceilings[1]], ["tool calling", ceilings[2]]] as const) {
    assert.ok(
      Number(limit) >= 1000,
      `${space} allows ${limit} output tokens, which truncates the reply once reasoning has taken its share`,
    );
  }
});

test("the runner declares the coordinate space its screenshots actually use", () => {
  // Verified against a recorded artifact: page.screenshot() with a 1180x720
  // viewport and the default deviceScaleFactor produces a 1180x720 image, and
  // the prompt tells the model exactly that. If these ever diverge, every click
  // lands scaled and it reads as a model that cannot aim.
  const source = readFileSync(
    path.join(import.meta.dirname, "..", "runner/run.ts"),
    "utf8",
  );

  assert.match(source, /imageWidth: WIDTH/, "the image is the viewport, unscaled");
  assert.match(source, /imageHeight: HEIGHT/);
  assert.match(
    source,
    /viewport: \{ width: WIDTH, height: HEIGHT \}/,
    "and the browser must be opened at that size",
  );
});

test("the runner honours each task's own budget, for the space it is running", () => {
  /*
   * Two bugs, one after the other. First the runner applied a flat 12 turns to
   * every task, so a task allowed 8 ran 12 — half again as many paid calls as
   * the task permits, and a recorded budget that contradicted the task page.
   * Then the per-task number was shared between the action spaces, which
   * under-powered the harder one: the same task costs a model driving pixels
   * roughly twice the turns, and it was judged against the tool-calling
   * ceiling.
   */
  const source = readFileSync(
    path.join(import.meta.dirname, "..", "runner/run.ts"),
    "utf8",
  );

  assert.match(source, /TURN_OVERRIDE \?\? turnsFor\(task, mode\)/, "the budget must depend on the mode");
  assert.match(source, /turn <= maxTurns/, "and it bounds the loop");
  assert.ok(!/turn <= MAX_TURNS/.test(source), "the flat global budget must not come back");
  assert.ok(
    !/task\.maxTurns/.test(source),
    "reading the budget object directly skips the mode, which is the whole point of it",
  );
});

test("each driver asks for the budget of the space it drives", () => {
  const dir = path.join(import.meta.dirname, "..");
  // One driver now. The in-page harness is gone: the console is static and
  // cannot reach a model, so every run comes from Playwright.
  for (const [file, mode] of [["runner/run.ts", "mode"]] as const) {
    const source = readFileSync(path.join(dir, file), "utf8");
    assert.match(
      source,
      new RegExp(`turnsFor\\(task, ${mode}\\)`),
      `${file} drives ${mode} and must ask for the ${mode} budget`,
    );
    assert.match(source, /turn <= maxTurns/, `${file} must bound its loop by it`);
    assert.ok(
      !/task\.maxTurns/.test(source),
      `${file} reads the budget object directly, which has no single number in it`,
    );
  }
});

test("the model is told the list scrolls and can be searched", () => {
  // It cannot discover an affordance it is never shown and never told about.
  const prompt = computerPrompt(VIEW);

  assert.match(prompt, /search box/);
  assert.match(prompt, /scrolls/);
});

test("the Playwright driver implements every action the reducer accepts", () => {
  const dir = path.join(import.meta.dirname, "..");
  const actions = readFileSync(path.join(dir, "lib/environment/actions.ts"), "utf8");
  const driver = readFileSync(path.join(dir, "runner/driver.ts"), "utf8");

  const names = [...actions.matchAll(/^\s{2}"([a-z_]+)",$/gm)].map((m) => m[1]);
  assert.ok(names.includes("search"), "the action list should have been parsed");

  for (const name of names) {
    assert.match(
      driver,
      new RegExp(`case "${name}"`),
      `${name} is accepted by the reducer but the browser driver cannot perform it`,
    );
  }
});

test("both system prompts are shown, and rendered from what is actually sent", () => {
  /*
   * A benchmark that paraphrases what it told the model is not reproducible by
   * anyone reading it. So the page renders the same constants the runner sends
   * rather than a transcription that can drift.
   */
  const dir = path.join(import.meta.dirname, "..");
  const page = readFileSync(path.join(dir, "components/harness/system-prompts.tsx"), "utf8");

  assert.match(page, /computerPrompt\(SCREEN\)/, "the computer-use prompt must be generated");
  assert.match(page, /SYSTEM_PROMPT/, "the tool-calling prompt must be the real constant");
  assert.ok(
    !/You are operating|Reply with exactly one/.test(page),
    "the prompt is transcribed into the page, so it can drift from what is sent",
  );

  assert.match(
    readFileSync(path.join(dir, "app/tools/page.tsx"), "utf8"),
    /<SystemPrompts \/>/,
    "the prompts are never rendered anywhere",
  );
});

test("no prompt hands the model a URL it cannot use", () => {
  /*
   * Playwright navigates to the environment before the model is asked anything,
   * so the page is already open. An address in the prompt would be a fact the
   * model can only be confused by — and one more thing to keep in step with the
   * deployment.
   */
  for (const prompt of [SYSTEM_PROMPT, computerPrompt(VIEW)]) {
    assert.ok(
      !/https?:\/\//.test(prompt),
      `a system prompt contains a URL: ${prompt.match(/https?:\/\/\S+/)?.[0]}`,
    );
  }
});

/*
 * The case the per-point rules cannot decide, which is most of the screen.
 *
 * The 0-1000 grid sits inside the pixel range of the real screenshot: the image
 * is 1180 wide and the grid stops at 1000, so on the x axis a grid coordinate
 * can never overshoot. The rule that recognises a grid only fires on an
 * overshoot. A model answering in the grid was therefore read as pixels almost
 * everywhere, every click landing up and to the left of what it aimed at, and
 * the run recorded as a model that cannot ground rather than a harness that
 * cannot convert.
 */
test("a grid coordinate that does not overshoot is reported as undecided, not as pixels", () => {
  const point = resolvePoint(500, 400, SCREEN);

  assert.equal(point.ambiguous, true, "the reading was treated as settled when it is not");
  assert.ok(point.alternate, "no competing reading was offered");
  assert.equal(point.alternate.convention, "grid1000");

  // 500/1000 of 1180 is 590, and 400/1000 of 720 is 288. Nothing about the
  // numbers says which of (500, 400) and (590, 288) the model meant.
  assert.equal(Math.round(point.alternate.x), 590);
  assert.equal(Math.round(point.alternate.y), 288);
});

test("the x axis alone can never reveal a grid, which is why this needed fixing", () => {
  // Every legal grid value is inside the image width, so no x can overshoot.
  // Before, only a y beyond 720 could trigger detection — 28% of the grid.
  for (const x of [1, 250, 500, 750, 1000]) {
    assert.ok(x <= SCREEN.imageWidth, `x=${x} would have overshot, which is the easy case`);
  }
});

test("an established convention overrides the rules and settles the reading", () => {
  const guessed = resolvePoint(500, 400, SCREEN);
  const pinned = resolvePoint(500, 400, SCREEN, "grid1000");

  assert.equal(guessed.convention, "pixels", "the default reading is the documented contract");
  assert.equal(pinned.convention, "grid1000");
  assert.equal(pinned.ambiguous, false, "a settled reading cannot still be undecided");
  assert.equal(pinned.alternate, null);
  assert.equal(Math.round(pinned.x), 590);
  assert.equal(Math.round(pinned.y), 288);
});

test("readings that are genuinely settled are not called undecided", () => {
  // A clear overshoot: only the grid can explain it.
  assert.equal(resolvePoint(950, 900, SCREEN).ambiguous, false);
  // Sub-pixel numbers in [0, 1]: only a fraction can explain them. Offering
  // pixel (0.25, 0.5) as a rival would make every fraction look undecided.
  assert.equal(resolvePoint(0.25, 0.5, SCREEN).ambiguous, false);
  // The very corner. A model aiming at (0, 0) means the corner, not the origin
  // of a grid, and the grid reading of (0, 0) is the same point anyway.
  assert.equal(resolvePoint(0, 0, SCREEN).ambiguous, false);
});

test("a competing reading that falls off the screen is not a competing reading", () => {
  // 1180 as a grid value is beyond 1000, so there is no grid reading at all.
  const edge = resolvePoint(SCREEN.imageWidth, SCREEN.imageHeight, SCREEN);
  assert.equal(edge.ambiguous, false);
  assert.equal(edge.alternate, null);
});

test("the runner settles the coordinate space from the page and then stops asking", () => {
  // Two hit tests on a page that is already open, no model call. And pinned:
  // a convention belongs to the model, not to the individual number, so
  // re-deciding it every turn would leave one run half in each space.
  const runner = source("runner/run.ts");

  assert.match(runner, /await calibrate\(page, alone, alone\.alternate\)/,
    "the runner no longer resolves an undecided reading against the page");
  assert.match(runner, /resolvePoint\(x, y, VIEWPORT, convention \?\? undefined\)/,
    "an established convention is not applied to later turns");
  assert.match(runner, /convention = settled/,
    "the settled convention is not kept");
});

test("an undecided calibration is not pinned", () => {
  // Both readings on a control, or neither: the page cannot tell them apart, so
  // there is nothing to learn. Pinning a coin flip is worse than not pinning.
  const driver = source("runner/driver.ts");
  assert.match(driver, /if \(hit\(here\) === hit\(there\)\) return null/,
    "calibration commits to an answer the page did not give");
  // The predicate, not merely the presence of the set. A `hit` that stops
  // consulting GENERIC leaves the declaration sitting there unused, and an
  // assertion that only looks for the name goes on passing.
  assert.match(
    driver,
    /const hit = \([^)]*\) =>[^\n]*!GENERIC\.has\(/,
    "any element counts as a hit, so every reading lands on something and nothing is decided",
  );
});

test("a reading only one space can explain settles that space by itself", () => {
  /*
   * The gap a real paid run fell through.
   *
   * The hit test only fires on an ambiguous reading, and can only settle one
   * where the two candidates land on different things. Every early click that
   * run was ambiguous and both readings hit some message row, so nothing was
   * pinned — and then the model sent y=843. On a 720-tall screen that is not a
   * pixel coordinate under any reading. It was the model saying outright which
   * space it was in, and nothing was listening: later clicks whose y happened
   * to fall under 720 were read as pixels and landed where it had not aimed.
   */
  const grid = resolvePoint(424, 843, SCREEN);
  assert.equal(grid.convention, "grid1000");
  assert.equal(grid.decisive, true, "a y beyond the screen does not settle the space");

  // The far corner: every grid reading of it lands off-image, so pixels is the
  // only explanation.
  assert.equal(resolvePoint(SCREEN.imageWidth, SCREEN.imageHeight, SCREEN).decisive, true);
});

test("agreement between readings is not evidence of anything", () => {
  // (0, 0) is not ambiguous — both readings are the same pixel — and it says
  // nothing about which space the model is answering in. Pinning off it would
  // fix the whole run to whichever convention the rules happened to name.
  const origin = resolvePoint(0, 0, SCREEN);
  assert.equal(origin.ambiguous, false);
  assert.equal(origin.decisive, false, "identical readings were treated as proof");
});

test("a settled reading is never also decisive", () => {
  // Once pinned there is no question left to settle, so neither flag may fire
  // and re-open it.
  const pinned = resolvePoint(424, 843, SCREEN, "pixels");
  assert.equal(pinned.decisive, false);
  assert.equal(pinned.ambiguous, false);
});

test("the runner settles from the numbers before it settles from the page", () => {
  // Free and certain beats a DOM lookup that can come back undecided.
  const runner = source("runner/run.ts");
  assert.match(
    runner,
    /if \(alone\?\.decisive && alone\.convention !== convention\)/,
    "a self-evident reading is not used to pin the space, or cannot contradict a declaration",
  );
  assert.match(
    runner,
    /const alone: Resolved \| null = read\s*\n?\s*\? resolvePoint\(read\.raw\.x, read\.raw\.y, VIEWPORT\)/,
    "the numbers are only ever read through the pinned convention, so they can never disagree with it",
  );
  assert.match(runner, /\} else if \(\n?\s*convention === null/, "the hit test is no longer the fallback");
});

test("the coordinate space is known from the model before a coordinate exists", () => {
  /*
   * The same per-provider knowledge polyact carries for Python, and verified
   * against the providers rather than assumed: Gemini's computer-use models
   * return a 0-1000 grid and document the conversion; Claude's return "the
   * pixel space of the full-display screenshots you return".
   *
   * A real paid run against Gemini went 22 turns without ever pinning, because
   * the runner had no prior and the evidence it did have was ambiguous. The
   * provider had published the answer the whole time.
   */
  assert.equal(declaredConvention("google/gemini-3.7-flash"), "grid1000");
  assert.equal(declaredConvention("anthropic/claude-sonnet-5"), "pixels");
  assert.equal(declaredConvention("openai/gpt-5.6-luna"), "pixels");
  assert.equal(declaredConvention("qwen/qwen3-vl-30b-instruct"), "grid1000");

  // Silence, not a guess. An unknown model falls through to the evidence.
  assert.equal(declaredConvention("minimax/minimax-m3:free"), null);
  assert.equal(declaredConvention(undefined), null);

  // The router is not a model. Which one answered is only knowable from the
  // reply, which is why this is keyed on the served model.
  assert.equal(declaredConvention("openrouter/free"), null);
});

test("the declaration is keyed on the model that answered, not the one asked for", () => {
  const runner = source("runner/run.ts");
  assert.match(
    runner,
    /declaredConvention\(reply\.model\)/,
    "the router's own name would be looked up instead of the model behind it",
  );
});