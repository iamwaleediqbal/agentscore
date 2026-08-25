import { SYSTEM_PROMPT } from "../lib/environment/serialize.ts";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  computerPrompt,
  describeResolution,
  resolvePoint,
  type Viewport,
} from "../lib/environment/computer.ts";

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

test("the prompt bounds the thought, because a truncated reply is a wasted turn", () => {
  const prompt = computerPrompt(VIEW);

  // The regression this guards: a model narrated at length, hit the output cap
  // mid-object, and the run recorded a parse failure that looked like a model
  // that cannot follow a format.
  assert.match(prompt, /under 25 words/);
  assert.match(prompt, /JSON object only/);
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
