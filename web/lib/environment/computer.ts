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

import type { Param, ToolSchema } from "./catalog.ts";

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
   * True when the numbers themselves settle the question: every other reading
   * puts the point off the screen, so only this one can be what was meant.
   *
   * Distinct from "not ambiguous". `(0, 0)` is not ambiguous either — both
   * readings land on the same pixel — and it tells you nothing about which
   * space the model is answering in. A y of 843 on a 720-tall screen tells you
   * everything: no model aiming in pixels emits it.
   */
  decisive: boolean;
  /**
   * Where the same numbers would land under the other reading, in CSS pixels,
   * or null when there is no other reading.
   */
  alternate: { x: number; y: number; convention: Convention } | null;
}

/**
 * What a model family answers in, according to the provider that built it.
 *
 * This is the same knowledge polyact carries for Python — its `CoordinateSpace`
 * is `PIXEL` / `NORMALIZED_1000` / `FIXED_GRID`, and its provider adapters map
 * Anthropic and OpenAI to pixels, Gemini and the Qwen-family grounding models
 * to the normalised grid. `grid1000` here is polyact's `NORMALIZED_1000`;
 * `pixels` is its `PIXEL`. Two languages, one set of rules, because the runner
 * that drives a browser here is TypeScript and polyact is the Python library.
 *
 * From the providers, not from folklore:
 *
 *   Gemini computer use returns coordinates on a 0-1000 grid and documents the
 *   conversion as `(value / 1000) * dimension`.
 *
 *   Claude's computer use tool returns "the pixel space of the full-display
 *   screenshots you return, with the origin at the top left", and the current
 *   toolset rejects display_width_px entirely because of it.
 *
 * A declaration is a strong prior and nothing more. It is applied on the first
 * turn, before any coordinate exists to inspect, and any coordinate that can
 * only be read one way overrides it — a model that follows the prompt instead
 * of its training is answering in the space it says it is, whatever its family
 * usually does.
 */
const DECLARED: ReadonlyArray<{ match: RegExp; convention: Convention }> = [
  { match: /(^|\/)google\/|gemini/i, convention: "grid1000" },
  { match: /qwen|ui-?tars|internvl/i, convention: "grid1000" },
  { match: /(^|\/)anthropic\/|claude/i, convention: "pixels" },
  { match: /(^|\/)openai\/|gpt-|\bo[34]\b/i, convention: "pixels" },
];

/**
 * The convention a model is expected to answer in, or null when nothing is
 * known about it.
 *
 * Keyed on the model that actually served the reply rather than the one that
 * was asked for: `openrouter/free` is a router, and which model answered is
 * only knowable after it has.
 */
export function declaredConvention(modelId: string | undefined): Convention | null {
  if (!modelId) return null;
  return DECLARED.find((entry) => entry.match.test(modelId))?.convention ?? null;
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

  /*
   * Whether the numbers rule the alternatives out, rather than merely differing
   * from them.
   *
   * A reading is decisive when some other convention was considered and put the
   * point off the screen — that is the numbers themselves saying which space
   * they are in. `(0, 0)` is not decisive: the alternatives were dropped for
   * landing on the same pixel, which is agreement, not evidence.
   */
  const ruledOut = (["pixels", "grid1000", "fraction"] as const)
    .filter((name) => name !== convention)
    .filter((name) => name !== "fraction" || inUnitRange)
    .map(reading)
    .some((other) => !inImage(other.imageX, other.imageY));

  return {
    ...toCss(chosen.imageX, chosen.imageY),
    convention,
    raw,
    outOfBounds: !inImage(chosen.imageX, chosen.imageY),
    // Both gated on `assume`: once the space is settled there is no competing
    // reading left to weigh, and offering one invites a caller to re-decide
    // something the run already decided from evidence.
    ambiguous: !assume && plausible.length > 0,
    decisive: !assume && plausible.length === 0 && ruledOut,
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
  params: readonly Param[];
  effect: string;
}> = [
  {
    name: "click",
    params: [
      { name: "x", type: "number", description: "Pixels from the left edge of the screenshot." },
      { name: "y", type: "number", description: "Pixels from the top edge of the screenshot." },
    ],
    effect: "Presses the left mouse button at that point.",
  },
  {
    name: "double_click",
    params: [
      { name: "x", type: "number", description: "Pixels from the left edge of the screenshot." },
      { name: "y", type: "number", description: "Pixels from the top edge of the screenshot." },
    ],
    effect: "Two clicks in quick succession.",
  },
  {
    name: "type",
    params: [{ name: "text", type: "string", description: "Text to type into whatever has focus." }],
    effect: "Types into whatever currently has focus. Click a field first.",
  },
  {
    name: "key",
    params: [
      {
        name: "name",
        type: "string",
        description: "Which key to press.",
        enum: ["Enter", "Tab", "Escape", "Backspace"],
      },
    ],
    effect: "Presses one key.",
  },
  {
    name: "scroll",
    params: [
      { name: "x", type: "number", description: "Pixels from the left edge of the screenshot." },
      { name: "y", type: "number", description: "Pixels from the top edge of the screenshot." },
      { name: "dy", type: "number", description: "How far to scroll. Positive is downwards." },
    ],
    effect: "Scrolls the pane under that point.",
  },
  { name: "wait", params: [], effect: "Does nothing for a moment, then re-photographs." },
  { name: "finish", params: [], effect: "Ends the run. The agent is claiming it is done." },
];

/**
 * The computer-use action space as JSON Schema.
 *
 * Anthropic, OpenAI and Google each ship a native computer-use tool with its
 * own action vocabulary. None of them is reachable through OpenRouter, whose
 * surface is the standard chat-completions API with ordinary function calling —
 * so a harness that goes through OpenRouter has to declare its own vocabulary.
 * Declaring it as *tools* rather than as prose in the system prompt is the part
 * that was wrong: the model is trained to emit a structured call, the provider
 * validates the arguments against the schema, and the whole class of "the reply
 * was cut off mid-object" stops existing.
 *
 * That this is a declared vocabulary rather than a provider-native computer-use
 * tool is a real limitation, and it is written down in the README rather than
 * implied away.
 */
export function computerToolSchemas(): ToolSchema[] {
  return COMPUTER_ACTIONS.map((action) => {
    const properties: ToolSchema["function"]["parameters"]["properties"] = {};
    const required: string[] = [];

    for (const param of action.params) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: [...param.enum] } : {}),
      };
      if (!param.optional) required.push(param.name);
    }

    return {
      type: "function",
      function: {
        name: action.name,
        description: action.effect,
        parameters: { type: "object", properties, required, additionalProperties: false },
      },
    };
  });
}

export function computerPrompt(viewport: Viewport): string {
  return `You are operating a computer. Each turn you are shown a screenshot of the screen and nothing else.

The screenshot is ${viewport.imageWidth} by ${viewport.imageHeight} pixels. Coordinates are measured from the top-left corner: x to the right, y downwards.

Call exactly one of the tools you have been given. Do not describe what you would do — do it.

Rules:
- One tool call per turn, and nothing else.
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
