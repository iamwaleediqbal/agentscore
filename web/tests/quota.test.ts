import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { refusedByDataPolicy } from "../lib/models.ts";

/**
 * Guards on how a rate limit is handled.
 *
 * A 429 is a statement about the account, not the request: every free model
 * draws on the same pool. Treating it as a transient error meant three retries
 * with backoff, then the same again against the next model in the chain, then
 * the whole thing repeated for each remaining task — roughly thirty requests
 * spent discovering a limit that the first response had already reported.
 *
 * These read the source rather than exercising the network, because the
 * behaviour worth protecting is a policy decision that is easy to undo by
 * adding one number back to a set.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("a 429 is not retried, because every free model draws on the same pool", () => {
  /*
   * A rate limit is a statement about the account, not the request. Treating it
   * as transient meant three retries with backoff, then the same against the
   * next model in the chain, then the whole thing again for each remaining task
   * — roughly thirty requests spent discovering a limit the first response had
   * already reported.
   */
  const source = read("runner/run.ts");

  assert.match(source, /429/, "the runner must recognise the status");
  assert.match(
    source,
    /throw new QuotaError\(`\$\{model\} reported 429/,
    "and stop on it rather than trying the next model",
  );
});

test("a quota failure is recognised as one rather than as a transport error", () => {
  /*
   * There is one caller now. The console used to proxy model calls through an
   * API route and this asserted on both; the console is static and holds no
   * key, so the runner is the only thing that can be throttled.
   */
  const source = read("runner/run.ts");

  assert.match(source, /429/, "the runner must recognise the status");
  assert.match(source, /QuotaError/, "and treat it as a quota stop, not a retry");
});

test("the runner throws a dedicated error for quota rather than continuing", () => {
  const source = read("runner/run.ts");

  assert.match(source, /class QuotaError/);
  assert.match(source, /throw new QuotaError/);
});

test("the runner checks the quota before spending any of it", () => {
  const source = read("runner/run.ts");

  assert.match(source, /auth\/key/, "the free limits endpoint does not draw on the quota");
  assert.match(source, /await checkQuota\(\)/, "and it has to actually be called");
});

test("a batch stops after the first infrastructure failure", () => {
  const source = read("runner/run.ts");

  // Five more tasks failing the same way is not five more measurements.
  assert.match(source, /stopping the batch/);
});

test("a batch that measured nothing does not overwrite what was published", () => {
  const source = read("runner/run.ts");

  assert.match(
    source,
    /index\.json is left as it was/,
    "six infrastructure failures must not replace real recorded runs",
  );
});

test("a spent quota ends the whole session, not just the task that discovered it", () => {
  /*
   * The recording script runs this process once per task, so a quota stop that
   * only breaks the batch loop inside one invocation is not a stop at all: the
   * next task starts a fresh process, spends a request finding out the quota is
   * gone, and does it again for every task left. Under --all there is nobody at
   * the keyboard to notice.
   */
  const runner = read("runner/run.ts");
  const script = read("record-runs.sh");

  // Both stop kinds exit 3, and for the same reason: there is nothing to gain
  // from starting the next task. A spent quota comes back on its own; an
  // account setting does not — but neither is fixed by trying again now.
  assert.match(
    runner,
    /process\.exit\(stopKind === "quota" \|\| stopKind === "config" \? 3 : 1\)/,
    "a quota or config stop must be distinguishable from a batch that merely recorded nothing",
  );
  assert.match(
    runner,
    /if \(stopKind === "quota"\) \{[\s\S]*process\.exit\(3\)/,
    "and it must still exit 3 after keeping the runs that did complete",
  );
  assert.match(
    script,
    /RUN_STATUS" -eq 3/,
    "the recording script never reads the exit code that tells it to stop",
  );
  assert.ok(
    /-eq 3 \][\s\S]{0,400}?STOP="yes"/.test(script),
    "reading the code is not the same as acting on it",
  );
});

test("screenshots from a run that recorded nothing are not left behind", () => {
  /*
   * The failure this exists for is on disk right now as this is written: a run
   * wrote its screenshots, failed before it reached a model, and exited on the
   * path that leaves index.json alone. The prune only ran on the success path,
   * so 380KB of images stayed in public/runs/shots — committed, deployed, and
   * unreachable, because no run in the index refers to them.
   */
  const source = read("runner/run.ts");

  assert.match(source, /async function pruneShots/, "the prune should be callable from both paths");
  const nothingRecorded = source.slice(0, source.indexOf("index.json is left as it was"));
  assert.match(
    nothingRecorded.slice(-1200),
    /await pruneShots\(published\)/,
    "the path that records nothing must still clean up after itself",
  );
});

test("no preflight step reports success it did not verify", () => {
  // Two green ticks were printed unconditionally. `[ -d node_modules ] || npm
  // install` printed "app dependencies" whether or not the install worked —
  // npm creates the directory before it starts fetching, so a failed install
  // leaves exactly the evidence that line read as success. And the Chromium
  // step printed its warning and then a tick underneath it, which reads as
  // recovered. A run that starts on a broken install fails much later and
  // blames something else.
  const script = read("record-runs.sh");

  assert.match(
    script,
    /node_modules\/next\/package\.json \][\s\S]{0,8}\|\| die/,
    "the app install is reported without checking a file was actually written",
  );
  assert.match(
    script,
    /npm install --no-audit --no-fund \|\| die/,
    "a failed app install does not stop the script",
  );
  // Anchored at `if ` with nothing between it and the command, so a negated
  // condition — `if ! playwright install …` with the tick still underneath —
  // does not match. The first version of this assertion did match it, which is
  // the same defect it was written to catch, one level up.
  assert.match(
    script,
    /\n\s*if \.\/runner\/node_modules\/\.bin\/playwright install chromium[^\n]*then\n\s*ok "Chromium"/,
    "the Chromium tick is printed outside the branch that earned it",
  );
});

test("a 429 means something different when the run is paid for", () => {
  /*
   * On the free tier a 429 is an account-level fact: every free model draws on
   * one pool, the next model in the chain answers identically, and another
   * attempt buys nothing but one fewer request tomorrow. Stopping is right.
   *
   * On a paid model it is that endpoint throttling. The pool is not shared, the
   * account has credit in it, and ending the session over one burst is the
   * free-tier reflex applied where it does not hold — a real run hit exactly
   * this and lost the batch.
   */
  const source = read("runner/run.ts");

  assert.match(source, /if \(PAID && !throttled\)/, "a paid 429 still ends the session immediately");
  assert.match(source, /throttled = true/, "the retry is not bounded to one attempt");
  // The message has to branch too. Telling someone paying for Gemini that "the
  // free tier is out of requests" sends them to look at the wrong thing.
  assert.match(
    source,
    /PAID\s*\n?\s*\? `\$\{model\} returned 429 twice/,
    "a paid 429 is still reported as a free-tier exhaustion",
  );
});

test("the quota line never prints a figure that cannot be true", () => {
  // The endpoint answers `-1` for "not bounded", which is truthy — so the line
  // read `-1/10s`, a rate limit of minus one request, printed with the same
  // confidence as the credit balance beside it.
  const source = read("runner/run.ts");

  assert.match(
    source,
    /\(data\.rate_limit\?\.requests \?\? 0\) > 0/,
    "a sentinel rate limit is printed as though it were a measurement",
  );
  assert.match(
    source,
    /limit_remaining\.toFixed\(4\)/,
    "the credit balance is printed to nine decimal places",
  );
});

test("a paid run says what it can actually cost, from a measured turn", () => {
  /*
   * BUDGET is a stop-loss the operator picks before seeing a single price.
   * Picked blind it ends up an order of magnitude above anything the run can
   * reach — at which point the turn cap is what bounds the run and the budget
   * is decoration. 0.30 was sized for the whole suite in both spaces, 208 turns;
   * spending it on one 22-turn task means the guard cannot fire.
   *
   * The first turn's reported cost times the remaining ceiling is rough, and it
   * is grounded in this model on this task rather than in a guess about how an
   * image tokenises.
   */
  const source = read("runner/run.ts");

  assert.match(source, /projected = reply\.cost \* maxTurns/, "nothing projects the ceiling");
  assert.match(
    source,
    /projected < BUDGET \/ 4/,
    "a budget far above the reachable maximum is not called out",
  );
  assert.match(
    source,
    /PAID && projected === null && reply\.cost > 0/,
    "the projection is recomputed every turn, or runs on a free batch",
  );
});

test("an account setting that blocks every provider stops the session too", () => {
  /*
   * OpenRouter answers a request it cannot route with a 404 reading "No
   * endpoints available matching your guardrail restrictions and data policy",
   * which looks like a missing model and is not: the id, the key and the price
   * ceiling are all fine, and the account refuses every provider serving it.
   *
   * Folded into the generic 4xx path it became "no model produced a usable
   * reply" — true, unhelpful, and pointing at the harness rather than at the
   * one setting that would fix it. Worse, the next five tasks would each spend
   * a request discovering the same thing.
   */
  const runner = read("runner/run.ts");

  assert.match(runner, /class ConfigError extends Error/);
  assert.match(
    runner,
    /refusedByDataPolicy\(detail\)[\s\S]{0,200}throw new ConfigError/,
    "a data-policy refusal must raise ConfigError rather than fall through to the 4xx break",
  );
  assert.match(
    runner,
    /openrouter\.ai\/settings\/privacy/,
    "and the message must say where the setting lives",
  );
  assert.match(
    runner,
    /if \(stopKind === "config"\) \{[\s\S]*?process\.exit\(3\)/,
    "a config stop must exit 3, so the recording script ends the session",
  );
});

test("the data-policy detector does not fire on an ordinary 404", () => {
  // A model id that is simply wrong must still be reported as a wrong id.
  assert.equal(refusedByDataPolicy("No endpoints found for tool_choice"), false);
  assert.equal(refusedByDataPolicy("model not found"), false);
  assert.equal(
    refusedByDataPolicy(
      "No endpoints available matching your guardrail restrictions and data policy",
    ),
    true,
  );
});
