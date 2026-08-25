/**
 * Batch runner. Drives a real Chromium against the gym, records what happened,
 * and writes run records the console can display alongside live ones.
 *
 * Every click here is a genuine click. The output is the same `RunRecord`
 * shape the in-page harness produces, with `runner: "playwright"` and
 * screenshots pointing at real JPEGs under public/runs — so a run produced
 * this way appears in the deployed console for every visitor, not just for
 * whoever happened to run it.
 *
 * Usage:
 *   npm run agent                      one task, one model
 *   npm run agent -- --all             every task
 *   npm run agent -- --task reply-and-file
 *   GYM_URL=https://…/gym npm run agent
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { isClassifierVerdict } from "../lib/agent/classify.ts";
import { parseTurn } from "../lib/agent/parse.ts";
import {
  type Convention,
  type Resolved,
  type Viewport,
  computerPrompt,
  describeResolution,
  resolvePoint,
} from "../lib/environment/computer.ts";
import { GYM_HOME } from "../lib/environment/contract.ts";
import { MAILBOX } from "../lib/environment/describe.ts";
import { grade } from "../lib/harness/grade.ts";
import {
  AFFORDABLE,
  FREE_ONLY,
  REASONING_EFFORT,
  freeModels,
  isPaidModel,
  reasoningOption,
  rejectsReasoning,
} from "../lib/models.ts";
import { SYSTEM_PROMPT } from "../lib/environment/serialize.ts";
import type { MailState } from "../lib/environment/state.ts";
import { TASKS, taskById, turnsFor } from "../lib/harness/tasks.ts";
import type { ActionStatus, TimelineEntry, Usage } from "../lib/harness/entries.ts";
import { usageOf } from "../lib/harness/entries.ts";
import { mergeRecorded, type RunRecord, type RunStatus } from "../lib/harness/runs.ts";
import {
  DriverError,
  calibrate,
  observe,
  perform,
  performComputer,
  photograph,
  begin,
  readState,
} from "./driver.ts";

/**
 * The environment to drive, public by default and always resolved to the page
 * that publishes the contract.
 *
 * The gym is a deployed application in its own repository, so a run does not
 * need anything started locally — which is also the point: the harness reaches
 * it the way anything else would, over HTTP, with no privileged access and no
 * shared process. Point GYM_URL at a local clickmail while developing one.
 *
 * The mailbox lives at `/gym`. The site root is a landing page explaining what
 * the project is — a perfectly good page that publishes no contract, so a run
 * pointed at it dies with "the gym never published its automation contract",
 * which is a true message about the wrong problem.
 *
 * That is an easy mistake to make from a browser: you copy the address bar. So
 * a bare origin is corrected rather than rejected, and anything already ending
 * in /gym is left alone.
 */
function resolveGymUrl(raw: string): string {
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/gym")) url.pathname = `${path}/gym`;
  return url.toString();
}

const GYM_URL = resolveGymUrl(process.env.GYM_URL ?? GYM_HOME);
const MODEL = process.env.MODEL ?? "openrouter/free";
/**
 * An override, not the budget.
 *
 * Each task carries its own turn budget, written by hand from what a correct
 * solve actually needs — 8 for the simple ones, 12 for the one that has to
 * discover a control does not exist. The runner used a flat 12 for everything,
 * so a task allowed 8 turns ran 12: half again as many model calls as the task
 * permits, a recorded `maxTurns` that contradicted the task page, and a run
 * that could not be compared with the same task run in the console.
 */
const TURN_OVERRIDE = process.env.MAX_TURNS ? Number(process.env.MAX_TURNS) : null;
const WIDTH = 1180;
const HEIGHT = 720;

/**
 * Spending, when it is asked for explicitly.
 *
 * Free is the default and stays the default. Naming a paid model is not enough
 * on its own: BUDGET must also be set, so choosing to spend and choosing how
 * much are the same decision rather than two, and forgetting the second cannot
 * quietly mean "unlimited".
 *
 * Three independent bounds, because each one alone has a way of failing:
 *
 *   1. The provider's own account total, read from /auth/key. Authoritative,
 *      survives a process restart, and does not depend on any per-call figure
 *      being reported. This is the one that actually holds the line.
 *   2. The cost each reply reports, summed within a task. Finer grained than
 *      the account total, so a runaway task stops mid-way rather than at the
 *      next boundary — but it is only as good as the provider's reporting,
 *      which is why it is not the only bound.
 *   3. A hard request cap per task, which needs no cost information at all and
 *      bounds the worst case even if both figures above are missing.
 *
 * The state file matters more than it looks: this process is spawned once per
 * task, so a total held only in memory resets every time and a budget meant for
 * a batch silently becomes a budget per task.
 */
const BUDGET = Number(process.env.BUDGET ?? 0);
const BUDGET_STATE = process.env.BUDGET_STATE ?? "";
/** Worst-case calls for a task: every turn it is allowed, every retry. */
const requestCapFor = (maxTurns: number) => maxTurns * 3;

interface BudgetState {
  /** Account usage when the session started, so spend is measured as a delta. */
  baseline: number;
  /** Cumulative reported cost across every task in this session. */
  spent: number;
}

async function readBudgetState(): Promise<BudgetState | null> {
  if (!BUDGET_STATE) return null;
  try {
    return JSON.parse(await readFile(BUDGET_STATE, "utf8")) as BudgetState;
  } catch {
    return null;
  }
}

async function writeBudgetState(state: BudgetState): Promise<void> {
  if (!BUDGET_STATE) return;
  try {
    await writeFile(BUDGET_STATE, JSON.stringify(state));
  } catch {
    // Losing the file means the next task cannot see this one's spend, so the
    // account-total check becomes the only bound. Say so rather than continue
    // quietly under a weaker guarantee than was asked for.
    console.error("  ! could not persist the budget state — spend may not accumulate");
  }
}

let PAID = false;
let spent = 0;
let requests = 0;
/** Set per task from that task's own turn budget, beside the counter it bounds. */
let requestCap = 36;

/**
 * Chromium screenshots the viewport at its real size, so image pixels and CSS
 * pixels coincide here. The in-page harness photographs at half scale and they
 * do not. Passing the geometry in rather than assuming it is what keeps one
 * driver's coordinates from being silently wrong in the other.
 */
const VIEWPORT: Viewport = {
  width: WIDTH,
  height: HEIGHT,
  imageWidth: WIDTH,
  imageHeight: HEIGHT,
};

type Mode = "computer" | "tool";
// Under public/ so the console can show the screenshots as plain static files.
const OUT = path.resolve("public/runs");

/** Controls the interface genuinely does not offer, versus ones that misfired. */
const NO_CONTROL = new Set(["forward", "label"]);

/** JPEG keeps a run's artifacts small enough to live in the repo. */
async function shoot(
  page: import("playwright").Page,
  dir: string,
  runFolder: string,
  name: string,
): Promise<string> {
  await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 72 });
  return `/runs/shots/${runFolder}/${name}.jpg`;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

type Content = string | Array<Record<string, unknown>>;

interface Message {
  role: string;
  content: Content;
}

interface Reply {
  content: string;
  /** The provider's chain of thought, when one was requested and returned. */
  reasoning?: string;
  usage: Usage;
  cost: number;
  model?: string;
  latencyMs: number;
}

function readUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, number>;
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  return { input, output, total: u.total_tokens ?? input + output };
}

/**
 * Ask the provider how much room is left, before spending any of it.
 *
 * `/auth/key` reports the key's limits and usage and does not draw on the
 * generation quota, so this costs nothing that a run would otherwise have. The
 * alternative — discovering the account is empty by watching six tasks fail one
 * turn at a time — is how a batch turns a rate limit into thirty wasted
 * requests.
 */
/** Credits spent so far on this key, or null when the figure is unavailable. */
async function creditsUsed(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { usage?: number } };
    const usage = payload.data?.usage;
    return typeof usage === "number" ? usage : null;
  } catch {
    return null;
  }
}

async function checkQuota(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    // Not being able to ask is not proof of a problem; let the run try.
    console.log("could not check the quota — continuing\n");
    return;
  }

  if (response.status === 401) throw new Error("the API key was rejected");
  if (response.status === 429) {
    throw new QuotaError("the free tier is out of requests — try again after it resets");
  }
  if (!response.ok) {
    console.log("could not check the quota — continuing\n");
    return;
  }

  // Shape is reported defensively: the fields below are what this endpoint
  // returns today, and a missing one should not stop a run that could work.
  const payload = (await response.json()) as {
    data?: {
      usage?: number;
      limit?: number | null;
      limit_remaining?: number | null;
      is_free_tier?: boolean;
      rate_limit?: { requests?: number; interval?: string };
    };
  };
  const data = payload.data ?? {};

  const parts: string[] = [];
  // Credits, not requests — see the note in record-runs.sh.
  if (typeof data.limit_remaining === "number") {
    parts.push(`$${data.limit_remaining} of key credit left`);
  }
  else if (typeof data.limit === "number" && typeof data.usage === "number") {
    parts.push(`${Math.max(0, data.limit - data.usage)} remaining of ${data.limit}`);
  } else if (typeof data.usage === "number") parts.push(`${data.usage} used`);
  if (data.rate_limit?.requests && data.rate_limit.interval) {
    parts.push(`${data.rate_limit.requests}/${data.rate_limit.interval}`);
  }
  if (data.is_free_tier) parts.push("free tier");

  console.log(`quota: ${parts.length ? parts.join(", ") : "reported, no figures given"}`);

  if (typeof data.limit_remaining === "number" && data.limit_remaining <= 0) {
    throw new QuotaError("the key has no requests left — try again after the quota resets");
  }
}

/** Free models with the capabilities this mode needs, router last. */
async function chainFor(mode: Mode): Promise<string[]> {
  // A named model is used as given. No fallback chain: falling back from a
  // paid model the user chose to a different one they did not would spend their
  // money on a measurement they never asked for.
  if (MODEL !== "openrouter/free") return [MODEL];
  try {
    const models = await freeModels(mode === "computer" ? "computer" : "tool");
    const vetted = models.filter((m) => !m.router).map((m) => m.id);
    // The router first because it spreads load, then models that passed the
    // capability filter, so one bad routing decision costs a retry not a run.
    // Five deep: the router, then four vetted models. Four was one short of
    // reaching a model we had direct evidence worked, which is a poor reason to
    // fail a run when the extra entries cost nothing unless they are reached.
    return ["openrouter/free", ...vetted].slice(0, 5);
  } catch {
    return ["openrouter/free"];
  }
}

/**
 * Thrown when the account is out of quota.
 *
 * Separated from every other failure because it is the one that must stop the
 * batch rather than move to the next model or the next task. A 429 is the
 * provider saying "not now" about the account, not about the request — so
 * retrying it, falling back to another free model, or starting the next task
 * all spend requests that were never going to succeed.
 */
export class QuotaError extends Error {}

/**
 * Thrown when a call reported a non-zero cost.
 *
 * Never expected: the request carries a hard price ceiling and the model list
 * is filtered on every pricing field. If one still bills, both guards failed
 * and the only safe move is to stop before the next turn does it again.
 */
export class BilledError extends Error {}

async function ask(messages: Message[], mode: Mode, chain: string[]): Promise<Reply> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const startedAt = Date.now();
  /**
   * Generous on purpose, and it costs nothing to be.
   *
   * Reasoning tokens are drawn from this same allowance. At 900 with minimal
   * reasoning, three turns in twelve arrived as `{"thought": "…", "acti` —
   * cut off mid-object, recorded as a parse failure, and indistinguishable in
   * the run from a model that cannot produce JSON. It was a model that was not
   * given room to finish the sentence.
   *
   * Raising a ceiling is free: only tokens actually generated are billed, and
   * the prompt already caps the thought at 25 words. The ceiling exists to stop
   * a runaway, not to shape the answer.
   */
  /*
   * Room for the reply *and* whatever the model thinks first.
   *
   * Reasoning tokens count against this ceiling. Computer use was raised to
   * 2500 after truncated JSON turned paid turns into wasted ones; tool calling
   * was left at 400 on the reasoning that its replies are short, which is true
   * of the reply and not of the budget it is drawn from. A model that spends
   * 350 tokens thinking has 50 left to answer in, and the turn is billed either
   * way.
   *
   * Raising it costs nothing on its own — generation is billed by tokens
   * produced, not by the ceiling offered.
   */
  const maxTokens = mode === "computer" ? 2500 : 1500;
  let lastReason = "no attempt made";

  for (const model of chain) {
    // Set when a model tells us it will not accept the reasoning field — either
    // because it cannot be disabled or because it is not supported at all. The
    // request is then retried without it rather than the model being written
    // off, which is what a plain 400 would have done.
    let dropReasoning = false;

    for (let attempt = 0; attempt < 4; attempt++) {
      // Bound 3: needs no pricing information at all, so it holds even when
      // every cost figure is missing.
      requests += 1;
      if (requests > requestCap) {
        throw new BilledError(
          `stopped after ${requests - 1} requests in one task — that is the hard cap`,
        );
      }
      if (attempt) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));

      let response: Response;
      try {
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0,
            max_tokens: maxTokens,
            // A hard ceiling either way: refuse anything that costs money, or
            // when spending is intended, refuse anything absurdly priced.
            provider: PAID ? AFFORDABLE : FREE_ONLY,
            // Held to the minimum the endpoint allows: private deliberation
            // bills at the output rate and was ninety-five per cent of the cost
            // of a turn at full effort.
            ...(dropReasoning ? {} : reasoningOption()),
          }),
        });
      } catch {
        lastReason = "the request did not complete";
        continue;
      }

      // Quota is an account-level fact. Every model on the free tier draws from
      // the same pool, so the next one in the chain will answer identically and
      // the only thing another attempt buys is one fewer request tomorrow.
      if (response.status === 429) {
        throw new QuotaError(
          `${model} returned 429 — the free tier is out of requests or throttling hard`,
        );
      }

      if (!response.ok) {
        // Read the body. A bare status is not a diagnosis: a 400 means the
        // request was malformed, and the provider says exactly which field it
        // objected to — throwing that away turns a one-line fix into guesswork.
        let detail = "";
        try {
          const body = await response.text();
          detail = body.slice(0, 300).replace(/\s+/g, " ").trim();
        } catch {
          /* body already consumed or unreadable */
        }
        lastReason = `${model} returned ${response.status}${detail ? `: ${detail}` : ""}`;

        // One field, and the model told us which. Drop it and try this model
        // again rather than moving on: "Reasoning is mandatory for this
        // endpoint and cannot be disabled" is not a reason to abandon a model
        // that works perfectly well without the field being set.
        if (response.status === 400 && rejectsReasoning(detail) && !dropReasoning) {
          dropReasoning = true;
          console.log(`  ${model} will not take the reasoning setting — retrying without it`);
          continue;
        }

        // Otherwise a malformed request will be malformed every time. Retrying
        // it and then sending the same thing to the next model is noise.
        if (response.status >= 400 && response.status < 500) break;
        continue;
      }

      const payload = await response.json();
      if (payload.error) {
        // Upstream failures arrive inside a 200 body, which is how a throttled
        // provider slips past a status-code check.
        if (Number(payload.error.code) === 429) {
          throw new QuotaError(`${model} reported 429 — the free tier is throttling`);
        }
        lastReason = `${model} reported an error`;
        continue;
      }

      const content = payload.choices?.[0]?.message?.content ?? "";
      const reasoning = payload.choices?.[0]?.message?.reasoning;

      // A 200 with nothing in it is a failed call wearing a success code.
      //
      // Worth exactly one more try — a pool under load does return these — but
      // not three. An endpoint that answers with nothing twice is broken rather
      // than busy, and the remaining attempts are better spent on the next
      // model than on proving that again.
      if (!content.trim()) {
        lastReason = `${model} returned an empty reply`;
        if (attempt >= 1) break;
        continue;
      }

      // Same answer every time from this endpoint, so move to the next model
      // rather than burning two more attempts on it.
      if (isClassifierVerdict(content)) {
        lastReason = `${model} is a safety classifier, not an assistant`;
        break;
      }

      const reportedCost = Number(payload.usage?.cost ?? 0);
      if (Number.isFinite(reportedCost) && reportedCost > 0) {
        if (!PAID) {
          // Nothing was supposed to cost anything. A charge means the price
          // ceiling did not hold and the catalogue filter let something
          // through; continuing would spend credits one turn at a time.
          throw new BilledError(
            `${model} charged ${reportedCost} credits — stopping. This run was configured for free models only.`,
          );
        }
        // Bound 2: fine-grained, within a task.
        spent += reportedCost;
        await writeBudgetState({ baseline: budgetBaseline, spent });
        if (spent >= BUDGET) {
          throw new BilledError(
            `budget reached: ${spent.toFixed(4)} of ${BUDGET} credits spent. Stopping mid-run.`,
          );
        }
      }

      return {
        content,
        reasoning: typeof reasoning === "string" && reasoning ? reasoning : undefined,
        usage: readUsage(payload.usage),
        // What the provider says this call cost. It was hardcoded to zero from
        // when only free models ran here — so every paid run recorded itself as
        // free while the budget guard, reading the same figure two lines above,
        // knew otherwise. A run record that disagrees with the meter is worse
        // than one with no cost field at all.
        cost: Number.isFinite(reportedCost) ? reportedCost : 0,
        model: payload.model ? String(payload.model) : model,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  throw new Error(`no model produced a usable reply: ${lastReason}`);
}

async function runTask(
  taskId: string,
  stamp: string,
  mode: Mode,
  chain: string[],
): Promise<RunRecord> {
  const task = taskById(taskId);
  if (!task) throw new Error(`no task ${taskId}`);

  // The task's own budget, unless deliberately overridden for an experiment.
  const maxTurns = TURN_OVERRIDE ?? turnsFor(task, mode);
  requestCap = requestCapFor(maxTurns);

  const id = `${stamp}-${mode}-${taskId}`;
  const shotDir = path.join(OUT, "shots", id);
  await mkdir(shotDir, { recursive: true });

  const startedAt = Date.now();
  // The hard request cap is per task, and --all runs several tasks in one
  // process, so it resets here rather than living for the life of the process.
  requests = 0;
  const entries: TimelineEntry[] = [];
  let status: RunStatus = "completed";
  let detail: string | undefined;
  let turns = 0;
  let final: MailState | null = null;
  /**
   * The coordinate space this model turned out to be answering in.
   *
   * Established once, from the page, on the first click the numbers alone
   * cannot settle — and then pinned. A convention is a property of the model,
   * not of an individual number, and re-deciding it every turn is how one run
   * ends up half in one space and half in the other.
   */
  let convention: Convention | null = null;
  /** The turn the convention was settled on, so the record says how it was decided. */
  let calibratedOn: number | null = null;
  // Hoisted: the verdict is computed after the try block, from the pair of
  // snapshots the environment reported either side of the run.
  let initial: MailState | null = null;

  const browser = await chromium.launch();
  // A fresh context per task: its own storage, cookies and cache, so nothing
  // carries over between tasks in a batch.
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();

  try {
    const url = new URL(GYM_URL);
    url.searchParams.set("run", id);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    /*
     * Fetch the world before the task starts.
     *
     * The harness does not install a mailbox. It asks the environment to reset,
     * takes back whatever the environment says is now true, and grades the
     * final snapshot against that — so the pair of states a verdict is computed
     * from both came from the application, not from the harness's idea of it.
     */
    initial = await begin(page);
    await shoot(page, shotDir, id, "00-start");

    // Computer use sends one screenshot per turn and a short written history.
    // Tool calling sends a serialised mailbox and the full transcript. They are
    // different observations, so they are different conversations.
    const history: string[] = [];
    let screen = mode === "computer" ? await photograph(page) : "";

    const messages: Message[] =
      mode === "computer"
        ? []
        : [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Task: ${task.prompt}\n\nScreen:\n${await observe(page)}` },
          ];

    let silent = 0;
    for (let turn = 1; turn <= maxTurns; turn++) {
      turns = turn;

      const outgoing: Message[] =
        mode === "computer"
          ? [
              { role: "system", content: computerPrompt(VIEWPORT) },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      `Task: ${task.prompt}`,
                      history.length ? `\nWhat you have done so far:\n${history.join("\n")}` : "",
                      "\nThis is the screen now. Reply with one JSON action.",
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  },
                  { type: "image_url", image_url: { url: screen } },
                ],
              },
            ]
          : messages;

      const reply = await ask(outgoing, mode, chain);
      const parsed = parseTurn(reply.content);

      entries.push({
        id: `${id}-t${turn}-think`,
        entry_type: "model_thinking",
        turn,
        at: Date.now(),
        text: parsed.thought,
        reasoning: reply.reasoning,
        latencyMs: reply.latencyMs,
        usage: reply.usage,
        cost: reply.cost,
        model: reply.model,
      });

      entries.push({
        id: `${id}-t${turn}-say`,
        entry_type: "model_response",
        turn,
        at: Date.now(),
        text: reply.content,
        parseError: parsed.action ? undefined : parsed.error,
      });

      if (!parsed.action) {
        silent += 1;
        if (silent >= 3) {
          status = "no_action";
          break;
        }
        if (mode === "computer") {
          history.push(`turn ${turn}: replied without an action`);
        } else {
          messages.push({ role: "assistant", content: reply.content });
          messages.push({
            role: "user",
            content: "That reply contained no action. Reply with one JSON action object.",
          });
        }
        continue;
      }
      silent = 0;

      if (parsed.action.name === "finish") {
        entries.push({
          id: `${id}-t${turn}-act`,
          entry_type: "action",
          turn,
          at: Date.now(),
          action_name: "finish",
          args: {},
          status: "terminal",
          metadata: { driver: "playwright" },
        });
        status = "completed";
        break;
      }

      let error: string | undefined;
      let hit: string | undefined;
      let point: Resolved | null = null;

      if (mode === "computer") {
        const { x, y } = parsed.action.args as { x?: unknown; y?: unknown };

        /*
         * Annotated, and the annotation is load-bearing. `tsc` rejects this
         * block without it: TS7022, "referenced indirectly in its own
         * initializer".
         *
         * The cycle is real rather than a compiler quirk, and it closes around
         * the loop this sits in:
         *
         *   read      is computed from `convention`
         *   convention is assigned `settled` further down
         *   settled   is read off `read`
         *
         * `convention` carries a declared type, but its *narrowed* type at this
         * line — still null, or settled on an earlier turn? — is flow-sensitive,
         * and the flow into here includes the assignment below arriving back
         * round the loop's back edge. So typing `read` needs `convention`, which
         * needs `settled`, which needs `read`.
         *
         * Declaring the type here lets the compiler know what `read` is without
         * evaluating what produces it, which cuts the cycle at one point instead
         * of chasing the errors along it — `settled`, then `other`, then `raw`,
         * each surfacing only once the one before it was annotated.
         */
        const read: Resolved | null =
          typeof x === "number" && typeof y === "number"
            ? resolvePoint(x, y, VIEWPORT, convention ?? undefined)
            : null;
        point = read;

        /*
         * Settle the coordinate space once, from the page, and then stop asking.
         *
         * This is the bug the whole project exists to be careful about, and it
         * was sitting in the runner: the rule that recognises a 0-1000 grid only
         * fires when a number overshoots the image. The image is 1180 wide and
         * the grid stops at 1000, so on the x axis it can never overshoot, and
         * on the y axis it only overshoots below 720 of 1000. A model answering
         * in the grid was therefore read as pixels almost everywhere on screen,
         * every click landing up and to the left of what it aimed at, and the
         * run recorded as a model that cannot ground rather than a harness that
         * cannot convert.
         *
         * Nothing about the numbers can separate the two. The page can: one
         * reading is on a control and the other is on nothing. Two hit tests, no
         * model call, and the answer holds for the rest of the run — a
         * convention belongs to the model, not to the individual number.
         */
        if (read && read.ambiguous && read.alternate && !read.outOfBounds) {
          const verdict = await calibrate(page, read, read.alternate);
          if (verdict) {
            const settled: Convention =
              verdict === "primary" ? read.convention : read.alternate.convention;
            convention = settled;
            point = resolvePoint(read.raw.x, read.raw.y, VIEWPORT, settled);
            calibratedOn = turn;
            console.log(
              `  coordinate space settled as ${settled} — both readings of ` +
                `(${read.raw.x}, ${read.raw.y}) were hit-tested against the page`,
            );
          }
        }

        const outcome = await performComputer(page, parsed.action, point);
        error = outcome.ok ? undefined : outcome.error;
        hit = outcome.hit;
        // Chromium repaints asynchronously; photographing immediately catches
        // the screen the action started from rather than the one it produced.
        await page.waitForTimeout(180);
      } else {
        try {
          await perform(page, parsed.action);
        } catch (caught) {
          error =
            caught instanceof DriverError
              ? caught.message
              : `the control could not be used: ${String(caught).slice(0, 140)}`;
        }
      }

      // Photographed after the click lands, so the picture shows the result of
      // this action rather than the screen it started from.
      const shot = await shoot(
        page,
        shotDir,
        id,
        `${String(turn).padStart(2, "0")}-${parsed.action.name}`,
      );

      const actionStatus: ActionStatus = !error
        ? "applied"
        : mode === "tool" && NO_CONTROL.has(parsed.action.name)
          ? "unavailable"
          : "rejected";

      entries.push({
        id: `${id}-t${turn}-act`,
        entry_type: "action",
        turn,
        at: Date.now(),
        action_name: parsed.action.name,
        args: parsed.action.args ?? {},
        status: actionStatus,
        error,
        screenshot: shot,
        metadata: {
          driver: "playwright",
          hit,
          point: point
            ? {
                raw: point.raw,
                convention: point.convention,
                css: { x: Math.round(point.x), y: Math.round(point.y) },
                label: describeResolution(point),
                outOfBounds: point.outOfBounds,
                // Set only on the turn the space was worked out, so a reader can
                // see the decision rather than infer it from the numbers.
                calibrated: calibratedOn === turn ? point.convention : undefined,
              }
            : undefined,
        },
      });

      if (mode === "computer") {
        history.push(
          `turn ${turn}: ${parsed.action.name}${point ? ` at ${describeResolution(point)}` : ""} → ${
            error ?? `hit ${hit ?? "something"}`
          }`,
        );
        screen = await photograph(page);
      } else {
        const observed = await observe(page);
        messages.push({ role: "assistant", content: reply.content });
        messages.push({
          role: "user",
          content: error
            ? `That failed: ${error}\n\nScreen:\n${observed}`
            : `Done. Screen now:\n${observed}`,
        });
      }

      if (turn === maxTurns) status = "max_turns";
    }

    final = await readState(page);
    await shoot(page, shotDir, id, "zz-final");
  } catch (caught) {
    status = "infrastructure_error";
    detail = String(caught instanceof Error ? caught.message : caught);
  } finally {
    await context.close();
    await browser.close();
  }

  // config_error is a browser-side condition (a missing key surfaces there as a
  // 401); the runner fails outright before it can produce a record, so
  // infrastructure_error is the only unscored outcome it can reach.
  const scored = status !== "infrastructure_error";
  const sum = usageOf(entries);

  return {
    id,
    taskId: task.id,
    taskTitle: task.title,
    model: MODEL,
    runner: "playwright",
    mode,
    status,
    detail,
    startedAt,
    durationMs: Date.now() - startedAt,
    turns,
    maxTurns,
    tokens: sum.usage,
    cost: sum.cost,
    entries,
    verdict:
      scored && initial && final ? grade(MAILBOX, initial, task.expected(initial), final) : null,
    // The pair the verdict came from, so it can be recomputed without a rerun.
    snapshots: initial && final ? { initial, final } : undefined,
  };
}

// --list prints the task table and exits, so a shell can drive one at a time
// without hardcoding a copy of the task ids that would drift.
if (process.argv.includes("--list")) {
  for (const task of TASKS) console.log(`${task.id}\t${task.title}\t${task.prompt}`);
  process.exit(0);
}

/**
 * --models shows the chain a run would use, without starting one.
 *
 * It calls the same resolver the runner calls, so what it prints is what would
 * actually be tried — a separate checking script would only ever verify its own
 * copy of the filter. The catalogue endpoint is free, so this costs nothing.
 */
if (process.argv.includes("--models")) {
  const listMode: Mode = arg("mode") === "tool" ? "tool" : "computer";
  const [chosen, catalogue] = await Promise.all([
    chainFor(listMode),
    freeModels(listMode === "computer" ? "computer" : "tool"),
  ]);
  console.log(`${listMode} mode: ${catalogue.length - 1} usable free model(s)\n`);
  console.log("the chain a run would try, in order:");
  chosen.forEach((id, index) => {
    const entry = catalogue.find((m) => m.id === id);
    const notes = [
      entry?.router ? "router" : null,
      entry && !entry.router && entry.vision ? "accepts images" : null,
      entry && !entry.router && !entry.structured ? "no structured signal" : null,
    ].filter(Boolean);
    console.log(`  ${index + 1}. ${id}${notes.length ? `   (${notes.join(", ")})` : ""}`);
  });
  const rest = catalogue.filter((m) => !m.router && !chosen.includes(m.id));
  if (rest.length) {
    console.log(`\nalso available but outside the chain: ${rest.length}`);
    for (const m of rest.slice(0, 8)) console.log(`     ${m.id}`);
  }
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
/*
 * Both selectors are validated before anything reaches the network.
 *
 * `--mode` used to be `=== "tool" ? "tool" : "computer"`, so `--mode toool`
 * recorded a full computer-use batch and said nothing — six tasks of quota
 * spent on the action space nobody asked for. `--task` with a typo threw from
 * inside the batch loop, after the model chain had already been resolved.
 *
 * A workflow dispatch is the case that matters: nobody is watching it, and the
 * only signal it gives back is what it published.
 */
const requestedMode = arg("mode") ?? "computer";
if (requestedMode !== "tool" && requestedMode !== "computer") {
  console.error(
    `\nunknown mode "${requestedMode}". The action spaces are "computer" and "tool".`,
  );
  process.exit(2);
}
const mode: Mode = requestedMode;

const requestedTask = arg("task");
if (requestedTask && !TASKS.some((t) => t.id === requestedTask)) {
  console.error(
    `\nunknown task "${requestedTask}". Available:\n  ` +
      TASKS.map((t) => t.id).join("\n  "),
  );
  process.exit(2);
}
if (!process.argv.includes("--all") && !requestedTask) {
  console.error(
    "\nname a task with --task, or pass --all to record every one.\n" +
      "Recording whichever task happened to be first is not something to do by default.",
  );
  process.exit(2);
}

const ids = process.argv.includes("--all") ? TASKS.map((t) => t.id) : [requestedTask!];

await mkdir(OUT, { recursive: true });

// Resolved once: the catalogue does not change between tasks in a batch, and
// fetching it per task would spend requests on the same answer.
await checkQuota();

// Decided from the catalogue, not the model's name: `:free` is a convention,
// and at least one genuinely free model does not carry it.
PAID = await isPaidModel(MODEL);

if (PAID && !(BUDGET > 0)) {
  console.error(
    `\n${MODEL} is a paid model. Set BUDGET to the most you are willing to spend, in credits:\n` +
      `  BUDGET=0.50 MODEL=${MODEL} ./record-runs.sh\n`,
  );
  process.exit(2);
}

// Measured before and compared after. The per-request price cap should make
// this impossible to move on a free run, which is exactly why it is worth
// checking: a guard nobody verifies is a guard nobody knows has failed.
const spentBefore = await creditsUsed();

/**
 * Bound 1, and the one that actually holds the line.
 *
 * This process is spawned once per task, so anything held only in memory starts
 * again from zero each time — a budget meant for a batch would quietly become a
 * budget per task, six times the figure that was set. The baseline is written
 * once and the account total is compared against it on every invocation, which
 * survives restarts and does not rely on any per-call cost being reported.
 */
let budgetBaseline = spentBefore ?? 0;
if (PAID) {
  const state = await readBudgetState();
  if (state) {
    budgetBaseline = state.baseline;
    spent = state.spent;
  } else {
    await writeBudgetState({ baseline: budgetBaseline, spent: 0 });
  }

  const accountSpend = spentBefore === null ? spent : spentBefore - budgetBaseline;
  const alreadySpent = Math.max(accountSpend, spent);

  console.log(
    `budget: ${alreadySpent.toFixed(4)} of ${BUDGET} credits used so far this session`,
  );

  if (alreadySpent >= BUDGET) {
    console.error(
      `\n  The budget is spent. Nothing further will run.\n` +
        `  Raise BUDGET, or start a new session to reset the count.\n`,
    );
    process.exit(2);
  }
  // Carry the authoritative figure forward, so a missing per-call cost cannot
  // make the running total drift below what has actually been billed.
  spent = alreadySpent;
}

const chain = await chainFor(mode);
console.log(`models: ${chain.join(", ")}`);
console.log(`reasoning: ${REASONING_EFFORT}\n`);

const runs: RunRecord[] = [];
let stoppedEarly = "";
/*
 * Why it stopped, not just that it did.
 *
 * The recording script spawns this process once per task, so "the quota is
 * gone" has to survive the exit or the next task starts a fresh process that
 * knows nothing and spends another request finding out. With --all that is one
 * wasted request per remaining task, which is precisely the grind this batch
 * loop already refuses to do inside a single invocation.
 */
let stopKind: "" | "quota" | "infrastructure" = "";

for (const taskId of ids) {
  process.stdout.write(`running ${taskId} (${mode}) … `);
  let run: RunRecord;
  try {
    run = await runTask(taskId, stamp, mode, chain);
  } catch (caught) {
    if (caught instanceof QuotaError || caught instanceof BilledError) {
      console.log("stopped");
      stoppedEarly = caught.message;
      stopKind = "quota";
      break;
    }
    throw caught;
  }
  console.log(run.verdict?.status ?? run.status);
  runs.push(run);

  // One task failing on infrastructure means the next five will too. Grinding
  // through them turns a bad minute into a spent daily allowance.
  if (run.status === "infrastructure_error") {
    stoppedEarly = run.detail ?? "the environment or the provider failed";
    stopKind = "infrastructure";
    console.log("\nstopping the batch: the first failure was infrastructure, not the model.");
    break;
  }
}

if (stoppedEarly) {
  console.log(`\n  ${stoppedEarly}`);
}

if (PAID) {
  // Re-anchor to the provider's figure before handing over to the next task:
  // it is the one that cannot drift, and the next invocation reads this file.
  const settled = await creditsUsed();
  if (settled !== null) spent = Math.max(spent, settled - budgetBaseline);
  await writeBudgetState({ baseline: budgetBaseline, spent });
  console.log(
    `\n  spent this session: ${spent.toFixed(4)} of ${BUDGET} credits ` +
      `(${(BUDGET - spent).toFixed(4)} left)`,
  );
}

const spentAfter = await creditsUsed();
if (spentBefore !== null && spentAfter !== null) {
  const delta = spentAfter - spentBefore;
  if (delta > 0 && PAID) {
    console.log(`  provider reports ${delta.toFixed(4)} credits used`);
  } else if (delta > 0) {
    console.error(
      `\n  WARNING: this batch spent ${delta} credits. It should have spent nothing.\n` +
        `  Every request carries a zero price ceiling and the model list is filtered on\n` +
        `  every pricing field, so this means one of those guards failed. Do not re-run\n` +
        `  until you know which.`,
    );
  } else {
    console.log(`  credits spent: none (balance unchanged)`);
  }
}

/**
 * A batch that measured nothing must not replace a batch that did.
 *
 * Overwriting index.json with six infrastructure failures loses whatever was
 * published before and puts records on the page that are not evidence about any
 * model. Nothing scored means nothing written.
 */
/**
 * Drop screenshot folders no published run refers to.
 *
 * Runs kept by --append still need their artifacts, so this is given the merged
 * list rather than this invocation's: pruning against one batch alone would
 * delete the screenshots of every task recorded earlier.
 */
async function pruneShots(published: RunRecord[]): Promise<void> {
  try {
    const keep = new Set(published.map((run) => run.id));
    const shotsRoot = path.join(OUT, "shots");
    for (const entry of await readdir(shotsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !keep.has(entry.name)) {
        await rm(path.join(shotsRoot, entry.name), { recursive: true, force: true });
        console.log(`  removed stale screenshots: ${entry.name}`);
      }
    }
  } catch {
    // Nothing to clean on the first recording.
  }
}

const scored = runs.filter((run) => run.status !== "infrastructure_error");
if (!scored.length) {
  /*
   * The run left its screenshots behind before it failed. Nothing will ever
   * refer to them again — index.json is deliberately left as it was — so
   * without this they sit in public/runs/shots being committed and deployed
   * as part of every future push, invisible because no page links to them.
   */
  let published: RunRecord[] = [];
  try {
    const existing = JSON.parse(
      await readFile(path.join(OUT, "index.json"), "utf8"),
    ) as { runs?: RunRecord[] };
    published = existing.runs ?? [];
  } catch {
    // No index yet: nothing is published, so nothing in shots/ is referenced.
  }
  await pruneShots(published);

  console.log(
    "\nNothing was recorded: no run reached a model, so index.json is left as it was.",
  );
  process.exit(stopKind === "quota" ? 3 : 1);
}

/**
 * --append keeps what is already published and adds to it.
 *
 * Recording one task at a time is the only way to watch a run before spending
 * on the next, and that is worth nothing if each invocation throws away the
 * previous one. A re-recorded task replaces its own earlier result and leaves
 * every other task alone.
 */
let merged: RunRecord[] = scored;
if (process.argv.includes("--append")) {
  try {
    const existing = JSON.parse(
      await readFile(path.join(OUT, "index.json"), "utf8"),
    ) as { runs?: RunRecord[] };
    const before = existing.runs ?? [];
    merged = mergeRecorded(before, scored);
    const kept = merged.length - scored.length;
    if (kept > 0) console.log(`  keeping ${kept} previously recorded run(s)`);
  } catch {
    // No index yet, or it is unreadable. This batch becomes the index.
  }
}

await pruneShots(merged);

// One index the app fetches at load. Committing it publishes these runs to
// every visitor; deleting it takes them down. No database either way.
await writeFile(
  path.join(OUT, "index.json"),
  JSON.stringify(
    { generated_at: stamp, driver: "playwright/chromium", mode, runs: merged },
    null,
    2,
  ),
);
console.log(`\n${merged.length} run(s) in public/runs/index.json`);

/*
 * Exit 3 means "do not start another task": the quota or the budget is spent,
 * and what is on disk has been kept. The recording script stops the session on
 * this code even under --all, where there is nobody at the keyboard to decide.
 */
if (stopKind === "quota") {
  console.log("\nStopping: the quota or budget is spent. What is above is saved.");
  process.exit(3);
}
