/**
 * Free models that can actually drive an application.
 *
 * The list is fetched rather than hardcoded: which models are free on
 * OpenRouter changes week to week, and a slug written into source is wrong
 * shortly after it is written. Deriving the allowlist from live pricing also
 * means a model that quietly becomes paid drops out on its own.
 *
 * The capability filter matters as much as the price one. What it must exclude
 * is models that are not assistants at all — safety classifiers, which answer
 * with a moderation verdict, and media generators, which are not chat models —
 * plus, for computer use, anything that cannot accept an image. A text-only
 * model handed a screenshot is not a failing agent but a category error, and
 * letting one into the picker would put that error on the leaderboard.
 *
 * What it must not do is demand capabilities this code never uses — a filter
 * strict enough to starve every run while looking principled. `tools` and
 * `structured_outputs` together once reduced eleven free vision models to two,
 * one of which was a preview endpoint that returned nothing.
 *
 * `tools` alone is now a hard requirement, and that is not a reversal of the
 * paragraph above: the code does use it. Every turn of both action spaces is a
 * tool call, so a model without tool support cannot answer the request at all,
 * and admitting one only buys a turn to discover what the catalogue already
 * said. `structured_outputs` is still not required, because nothing here sends
 * `response_format`.
 */

export interface FreeModel {
  id: string;
  name: string;
  context: number;
  router?: boolean;
  /** Accepts images, and can therefore be given a screenshot. */
  vision?: boolean;
  /**
   * Advertises tool calling, which every turn needs. A requirement, not a
   * preference — see the note at the top of this file.
   */
  tools?: boolean;
  /** The provider labels this endpoint preview/alpha/beta. Tried last. */
  preview?: boolean;
}

/** Which action space a model is being picked for. */
export type Mode = "tool" | "computer";

/**
 * Sent with every request as a hard ceiling.
 *
 * Unlike the other routing preferences this one refuses the request rather than
 * picking something else: if a provider would charge anything, nothing runs.
 * That makes it the only guarantee here that does not depend on the local
 * filter being correct — and the local filter has already been wrong once.
 */
export const FREE_ONLY = {
  max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
} as const;

/**
 * The ceiling used when a paid model is deliberately chosen.
 *
 * Still a hard limit, just not zero. Its job is no longer "never spend" but
 * "never spend a surprising amount": a mistyped model id or a provider that
 * silently reprices cannot route to something costing fifty times what was
 * intended. The figures are generous against a cheap multimodal model and
 * absurd against a frontier one, which is exactly the line worth drawing.
 *
 * Per million tokens, which is the unit max_price takes.
 */
export const AFFORDABLE = {
  max_price: { prompt: 2, completion: 10, request: 0, image: 2 },
} as const;

/**
 * Reasoning, held to the minimum the endpoint allows.
 *
 * A reasoning model narrates privately before answering, and those tokens bill
 * at the *output* rate. Measured on this workload: one turn of Gemini 3.7 Flash
 * at full effort cost 0.0123 credits, roughly six thousand of them reasoning —
 * about ninety-five per cent of the spend, to decide where a star icon is.
 *
 * The default is `minimal`, not `none`, because `none` is not universally
 * available: Gemini 3.7 Flash answers a request to disable reasoning with
 * "Reasoning is mandatory for this endpoint and cannot be disabled." Asking for
 * the least a model will give is portable in a way that asking for zero is not,
 * and it costs about the same.
 *
 * `exclude: true` is the trap and is never used: it only hides the tokens from
 * the response and bills for them identically.
 *
 * Minimal reasoning still returns a chain of thought, which the timeline shows
 * — so the cheap setting is also the one that keeps the run worth reading.
 * REASONING=low or higher buys more deliberation; the run record carries which
 * setting produced it, so two are never silently compared.
 */
export const REASONING_EFFORT = process.env.REASONING ?? "minimal";

export function reasoningOption(): Record<string, unknown> {
  return REASONING_EFFORT === "default" ? {} : { reasoning: { effort: REASONING_EFFORT } };
}

/** A 400 that is specifically about the reasoning parameter, not the request. */
export function rejectsReasoning(detail: string): boolean {
  return /reasoning/i.test(detail);
}

/**
 * A refusal that is about `tool_choice` itself, rather than about the request.
 *
 * Not every endpoint behind OpenRouter accepts the field. Some reject the value
 * outright; some fail at the routing layer with "no endpoints found for
 * tool_choice", which arrives as a 404 rather than a 400 and is not obviously
 * about a parameter at all. Either way the model is perfectly capable of making
 * the call — it just will not be told it has to — so dropping the field and
 * asking again is worth one retry, where moving to the next model in the chain
 * would abandon a working endpoint over an optional hint.
 *
 * `tools` itself is never dropped. A turn without the action space is not a
 * degraded measurement, it is a different one.
 */
export function rejectsToolChoice(detail: string): boolean {
  return /tool_choice/i.test(detail);
}

/**
 * Whether a model costs money, according to the catalogue rather than its name.
 *
 * The `:free` suffix is a naming convention, not a guarantee: the catalogue
 * lists models with all-zero pricing and no suffix (and the suffix could in
 * principle appear on something that charges). Deciding from the name got it
 * backwards for at least one real model, which would have been sent the
 * permissive price ceiling while the operator believed it was free.
 *
 * Unknown models are treated as paid. If the catalogue cannot be reached, the
 * safe assumption is the expensive one.
 */
export async function isPaidModel(id: string): Promise<boolean> {
  if (id === ROUTER.id) return false;
  try {
    const models = await allFree();
    return !models.some((m) => m.id === id);
  } catch {
    return true;
  }
}

interface RawModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: Record<string, unknown>;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 10 * 60 * 1000;

/**
 * Models that are not assistants, excluded by name.
 *
 * The catalogue lists safety classifiers alongside chat models and marks them
 * no differently. Handed an agent prompt they answer with a moderation verdict,
 * which parses as "no action" and lands on the leaderboard as a model that
 * cannot follow instructions. There is a runtime check for the verdicts they
 * produce; this keeps them out of the chain in the first place so a turn is not
 * spent discovering it.
 *
 * Name-matching is a blunt instrument and it is used deliberately as a
 * pre-filter, not the only defence — `isClassifierVerdict` still guards the
 * response side for anything named less obviously.
 */
const NOT_AN_ASSISTANT = /(guard|content-safety|moderation|nsfw|classifier)/i;

/**
 * OpenRouter's free router. It picks among currently-available free models and
 * filters them by the capabilities a request needs, which sidesteps the
 * throttling that makes any single free pool unreliable.
 */
export const ROUTER: FreeModel = {
  id: "openrouter/free",
  name: "Auto (free router)",
  context: 200_000,
  router: true,
  // The router selects among free models by the capabilities a request needs,
  // so it can serve either mode.
  vision: true,
};

let cache: { at: number; models: FreeModel[] } | null = null;

function isZero(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n === 0;
}

/**
 * Every way a model can charge, not just the two obvious ones.
 *
 * The catalogue really does list models priced at zero for prompt and
 * completion that still bill for `image`, `audio`, `internal_reasoning` or
 * `web_search`. Computer use sends a screenshot on every single turn, so a
 * filter that checks only prompt and completion would have put a per-image
 * charge on every turn of every run and called it free.
 *
 * So the test is inverted: rather than listing the fields that must be zero —
 * a list that goes stale the moment a new billing dimension is added — nothing
 * in the pricing object may be non-zero. An unknown field defaults to unsafe.
 */
function costsNothing(pricing: Record<string, unknown> | undefined): boolean {
  if (!pricing) return false;
  // A model that declares no prices at all is not evidence of being free.
  if (!isZero(pricing.prompt) || !isZero(pricing.completion)) return false;

  for (const [field, value] of Object.entries(pricing)) {
    if (value === undefined || value === null || value === "") continue;
    const amount = Number(value);
    // Non-numeric entries are metadata, not a charge.
    if (!Number.isFinite(amount)) continue;
    if (amount !== 0) return false;
    void field;
  }
  return true;
}

async function allFree(): Promise<FreeModel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const response = await fetch(MODELS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`model list unavailable (${response.status})`);

  const payload = (await response.json()) as { data?: RawModel[] };
  const capable = (payload.data ?? [])
    .filter((m): m is RawModel & { id: string } => typeof m.id === "string")
    .filter((m) => costsNothing(m.pricing))
    .filter((m) => (m.architecture?.input_modalities ?? ["text"]).includes("text"))
    // Text out, and *only* text out. The catalogue lists music and image
    // generators whose declared output modalities include text; asking one to
    // drive a mailbox wastes a turn discovering it was never a chat model.
    .filter((m) => {
      const out = m.architecture?.output_modalities ?? ["text"];
      return out.includes("text") && !out.includes("audio") && !out.includes("image");
    })
    .filter((m) => !NOT_AN_ASSISTANT.test(m.id) && !NOT_AN_ASSISTANT.test(m.name ?? ""))
    // Every turn is a tool call. A model that cannot make one is not a harder
    // opponent, it is an endpoint that will refuse the request.
    .filter((m) => (m.supported_parameters ?? []).includes("tools"))
    .filter((m) => m.id !== ROUTER.id)
    .map((m) => ({
      id: m.id,
      name: (m.name ?? m.id).replace(/\s*\(free\)\s*$/i, ""),
      context: m.context_length ?? 0,
      // Declared by the catalogue, not inferred from the name. Several models
      // read as multimodal and are not.
      vision: (m.architecture?.input_modalities ?? []).includes("image"),
      /*
       * Required now, and it did not used to be.
       *
       * The harness parsed JSON out of plain text and never sent `tools`, so
       * this was a ranking signal — a model trained to emit structured calls
       * tends to be better at emitting a bare JSON object too. Both action
       * spaces now send `tools` with `tool_choice: "required"`, so a model that
       * does not support them cannot answer at all, and offering it one is a
       * turn bought to discover something the catalogue already said.
       *
       * It costs coverage, and the cost is real: requiring structure once cut
       * eleven free vision models to one working endpoint. That is the honest
       * trade for a mode called tool calling that actually calls tools — and a
       * chain that is short and works beats a long one that spends the day's
       * quota finding out.
       */
      tools: (m.supported_parameters ?? []).includes("tools"),
      // Endpoints the provider itself labels unfinished. Not excluded — a
      // preview that works is worth having — but tried after stable ones,
      // because the observed failure here was a preview endpoint returning
      // empty replies while advertising every capability we rank on.
      preview: /(preview|alpha|beta|experimental)/i.test(m.id),
    }))
    .sort((a, b) => {
      // Stable before preview, then models that advertise structure, then name.
      if (a.preview !== b.preview) return a.preview ? 1 : -1;
      if (a.tools !== b.tools) return a.tools ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const seen = new Set<string>([ROUTER.id]);
  const models = [
    ROUTER,
    ...capable.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))),
  ];
  cache = { at: Date.now(), models };
  return models;
}

/**
 * The models that can serve one mode.
 *
 * Computer use additionally requires image input. That filter is usually
 * severe — the free tier holds far fewer vision models than text ones — and
 * that scarcity is a real fact about running this cheaply, not something to
 * paper over by letting blind models through.
 */
export async function freeModels(mode: Mode = "tool"): Promise<FreeModel[]> {
  const models = await allFree();
  if (mode !== "computer") return models;
  return models.filter((m) => m.router || m.vision);
}

export async function isAllowed(id: string, mode: Mode = "tool"): Promise<boolean> {
  if (id === ROUTER.id) return true;
  return (await freeModels(mode)).some((m) => m.id === id);
}
