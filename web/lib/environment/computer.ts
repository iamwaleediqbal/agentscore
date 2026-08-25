/**
 * The computer-use action space.
 *
 * This is the one that is actually hard. The model receives a screenshot and
 * nothing else — no element ids, no serialised DOM, no list of what is on
 * screen — and has to answer with coordinates. Finding the star icon is the
 * task, not a step that has been done for it.
 *
 * The semantic space in `actions.ts` is deliberately kept alongside it as a
 * separate mode rather than deleted. `star(id)` measures whether a model can
 * decide what to do; `click(x, y)` measures whether it can also find where to
 * do it. Running the same task under both, graded by the same golden state, is
 * the only way to say which of the two a failure came from.
 */

export type ComputerActionName =
  | "click"
  | "double_click"
  | "type"
  | "key"
  | "scroll"
  | "wait"
  | "finish";

export interface ComputerAction {
  name: string;
  args: Record<string, unknown>;
}

/** The coordinate convention a model's numbers turned out to be in. */
export type Convention = "pixels" | "grid1000" | "fraction";

export interface Viewport {
  /** CSS pixels of the environment itself. */
  width: number;
  height: number;
  /** Pixels of the screenshot the model was shown. */
  imageWidth: number;
  imageHeight: number;
}

export interface Resolved {
  /** CSS pixels inside the environment, ready to hit-test. */
  x: number;
  y: number;
  convention: Convention;
  /** Exactly what the model said, before any conversion. */
  raw: { x: number; y: number };
  /** True when the point falls outside the screen the model was shown. */
  outOfBounds: boolean;
  /**
   * True when the numbers are equally legal in more than one convention, so
   * the one above was picked by a rule rather than established by evidence.
   *
   * This is the case the per-point rules cannot decide, and it is most of the
   * screen. The 0-1000 grid sits *inside* the pixel range of a 1180x720 image,
   * so "500, 400" is a valid pixel pair and a valid grid pair, and the only
   * signal separating them is what is actually underneath each reading.
   */
  ambiguous: boolean;
  /**
   * Where the same numbers would land under the other reading, in CSS pixels,
   * or null when there is no other reading.
   */
  alternate: { x: number; y: number; convention: Convention } | null;
}

/**
 * Work out what coordinate space a model answered in, and convert to CSS pixels.
 *
 * Providers disagree about this and none of them announce it. Anthropic's
 * computer-use models answer in the pixels of the image they were given.
 * Several open grounding models were trained on a 0-1000 grid regardless of
 * image size. A few answer in fractions of the screen. Rejecting two of those
 * three as malformed would report a grounding model as broken when it was
 * merely speaking a different dialect, so the harness reads the dialect off the
 * numbers and records which one it decided on — a guess that is written down is
 * reviewable; a guess that is silent is not.
 *
 * The rules, in order:
 *   fraction  both values sit in [0, 1] and at least one is not a whole number
 *   grid1000  a value overshoots the image but both stay within 1000
 *   pixels    anything else, which is also the documented contract
 *
 * (0, 0) and (1, 1) are whole numbers, so they stay pixels. A model aiming at
 * the very corner of the screen means the corner, not the whole screen.
 */
export function resolvePoint(
  rawX: number,
  rawY: number,
  viewport: Viewport,
  /**
   * A convention already established for this run, which overrides the rules.
   *
   * The per-point rules below cannot settle the common case, so the runner
   * settles it once from evidence — it hit-tests both readings against the live
   * page and keeps whichever one lands on a control — and then pins the answer
   * here for the rest of the run. A convention is a property of the model, not
   * of the individual number, and re-guessing it every turn is how one run ends
   * up half in one space and half in the other.
   */
  assume?: Convention,
): Resolved {
  const raw = { x: rawX, y: rawY };
  const { imageWidth: iw, imageHeight: ih, width, height } = viewport;

  const toCss = (imageX: number, imageY: number) => ({
    // The screenshot may be captured at a fraction of the real viewport, so
    // image pixels are not CSS pixels. Getting this backwards puts every click
    // in the top-left quarter of the screen and looks exactly like a model that
    // cannot aim.
    x: (imageX / iw) * width,
    y: (imageY / ih) * height,
  });

  const inImage = (imageX: number, imageY: number) =>
    imageX >= 0 && imageY >= 0 && imageX <= iw && imageY <= ih;

  const reading = (convention: Convention) => {
    if (convention === "fraction") return { convention, imageX: rawX * iw, imageY: rawY * ih };
    if (convention === "grid1000") {
      return { convention, imageX: (rawX / 1000) * iw, imageY: (rawY / 1000) * ih };
    }
    return { convention, imageX: rawX, imageY: rawY };
  };

  const inUnitRange = rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1;
  const hasFraction = !Number.isInteger(rawX) || !Number.isInteger(rawY);

  /*
   * The rules, in order, when nothing has been established yet:
   *   fraction  both values sit in [0, 1] and at least one is not a whole number
   *   grid1000  a value overshoots the image but both stay within 1000
   *   pixels    anything else, which is also the documented contract
   *
   * (0, 0) and (1, 1) are whole numbers, so they stay pixels. A model aiming at
   * the very corner of the screen means the corner, not the whole screen.
   */
  let convention: Convention;
  if (assume) convention = assume;
  else if (inUnitRange && hasFraction) convention = "fraction";
  else if ((rawX > iw || rawY > ih) && rawX <= 1000 && rawY <= 1000) convention = "grid1000";
  else convention = "pixels";

  const chosen = reading(convention);

  /*
   * Which other readings these same numbers would also satisfy.
   *
   * Only counted when the alternative lands on the screen: a reading that falls
   * off the image is not a competing interpretation, it is a wrong one. And
   * only reported when nothing has been established yet — once the run knows
   * what the model speaks, there is no ambiguity left to report.
   */
  const others = (["pixels", "grid1000", "fraction"] as const)
    .filter((name) => name !== convention)
    .map(reading)
    .filter((other) => inImage(other.imageX, other.imageY))
    .filter((other) => Math.abs(other.imageX - chosen.imageX) > 1 || Math.abs(other.imageY - chosen.imageY) > 1);

  // A fraction reading is only plausible when the numbers are actually in
  // [0, 1]; otherwise it is arithmetic, not an interpretation. And once the
  // numbers ARE fractional, nothing competes with it: no model aims at pixel
  // (0.25, 0.5), so offering the top-left corner as a rival reading would make
  // every fraction look undecided.
  const plausible =
    convention === "fraction"
      ? []
      : others.filter((other) => other.convention !== "fraction" || inUnitRange);

  return {
    ...toCss(chosen.imageX, chosen.imageY),
    convention,
    raw,
    outOfBounds: !inImage(chosen.imageX, chosen.imageY),
    // Both gated on `assume`: once the space is settled there is no competing
    // reading left to weigh, and offering one invites a caller to re-decide
    // something the run already decided from evidence.
    ambiguous: !assume && plausible.length > 0,
    alternate:
      !assume && plausible.length
        ? { ...toCss(plausible[0].imageX, plausible[0].imageY), convention: plausible[0].convention }
        : null,
  };
}

/** Human-readable note for the timeline, so the conversion is visible, not implied. */
export function describeResolution(resolved: Resolved): string {
  const { raw, x, y, convention } = resolved;
  const at = `(${Math.round(x)}, ${Math.round(y)})`;
  if (convention === "pixels" && raw.x === Math.round(x) && raw.y === Math.round(y)) {
    return `${at} px`;
  }
  const label =
    convention === "grid1000" ? "0-1000 grid" : convention === "fraction" ? "fraction" : "px";
  return `(${raw.x}, ${raw.y}) ${label} → ${at} px`;
}

export const COMPUTER_ACTIONS: ReadonlyArray<{
  name: ComputerActionName;
  args: string;
  effect: string;
}> = [
  { name: "click", args: "x, y", effect: "Presses the left mouse button at that point." },
  { name: "double_click", args: "x, y", effect: "Two clicks in quick succession." },
  { name: "type", args: "text", effect: "Types into whatever currently has focus." },
  { name: "key", args: "name", effect: "One key: Enter, Tab, Escape, Backspace." },
  { name: "scroll", args: "x, y, dy", effect: "Scrolls the pane under that point." },
  { name: "wait", args: "—", effect: "Does nothing for a moment, then re-photographs." },
  { name: "finish", args: "—", effect: "Ends the run. The agent is claiming it is done." },
];

export function computerPrompt(viewport: Viewport): string {
  return `You are operating a computer. Each turn you are shown a screenshot of the screen and nothing else.

The screenshot is ${viewport.imageWidth} by ${viewport.imageHeight} pixels. Give coordinates in that space, measured from the top-left corner: x to the right, y downwards.

Reply with exactly one JSON object and no other text:

{"thought": "what you see and what you are about to do", "action": {"name": "click", "args": {"x": 120, "y": 340}}}

Available actions:
${COMPUTER_ACTIONS.map((a) => `  ${a.name}(${a.args}) — ${a.effect}`).join("\n")}

Rules:
- Reply with the JSON object only. No preamble, no explanation around it.
- Keep "thought" under 25 words. A long thought can run out of output budget
  before the action is written, and a reply cut off mid-object is a wasted turn.
- You cannot see element names or ids. Read the screenshot.
- A click that lands on nothing is still a turn you have spent.
- To type into a field, click it first, then type. The list has a search box.
- The list scrolls. If what you want is not visible, scroll it or search.
- Do exactly what was asked and nothing more, then call finish. Extra changes count against you.`;
}

/**
 * The one geometry there is.
 *
 * There used to be two: Chromium photographed the viewport at 1180×720 where
 * image pixels and CSS pixels coincide, and an in-page harness photographed the
 * DOM at half scale where they did not. Two geometries meant two chances to
 * convert a coordinate wrongly, and a model that clicked the top-left corner of
 * every screen looked like a weak model rather than a scaling bug.
 *
 * Runs now come from one driver, so there is one number. Anything that needs to
 * place a click on a screenshot reads it from here.
 */
export const SCREEN = {
  width: 1180,
  height: 720,
  imageWidth: 1180,
  imageHeight: 720,
} as const;
