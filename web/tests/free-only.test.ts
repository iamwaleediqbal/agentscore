import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { AFFORDABLE, FREE_ONLY, rejectsToolChoice } from "../lib/models.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

/**
 * Source with comments removed.
 *
 * Asserting that a pattern is *absent* from a file is worthless while prose can
 * satisfy it: a comment explaining why `exclude: true` is wrong made the test
 * that forbids `exclude: true` fail, and in the other direction would have made
 * it pass over real code.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Guards on spending money.
 *
 * The account has purchased credits, and the project must never touch them.
 * Three independent things stand between a run and a charge: a hard price
 * ceiling sent with every request, a catalogue filter that rejects any model
 * with any non-zero price, and a check on the reported cost of each reply.
 * Each of these tests protects one of them.
 */

test("the price ceiling forbids every billing dimension, not just tokens", () => {
  // The one that mattered: a model can price prompt and completion at zero and
  // still charge per image, and computer use sends an image every turn.
  assert.equal(FREE_ONLY.max_price.prompt, 0);
  assert.equal(FREE_ONLY.max_price.completion, 0);
  assert.equal(FREE_ONLY.max_price.request, 0);
  assert.equal(FREE_ONLY.max_price.image, 0);
});

test("both callers send a hard price ceiling with every request", () => {
  // The deployed route is free-only unconditionally: visitors must never be
  // able to spend the owner's credits. The runner sends the zero ceiling too,
  // unless a paid model was deliberately chosen with a budget.
  assert.match(read("runner/run.ts"), /provider: PAID \? AFFORDABLE : FREE_ONLY/);
  assert.match(read("runner/run.ts"), /provider: PAID \? AFFORDABLE : FREE_ONLY/);
});

test("a reported cost stops the caller instead of being absorbed", () => {
  assert.match(read("runner/run.ts"), /BilledError/);
  assert.match(read("runner/run.ts"), /class BilledError/);
  assert.match(read("runner/run.ts"), /throw new BilledError/);
});

test("the runner compares the credit balance either side of a batch", () => {
  const source = read("runner/run.ts");

  assert.match(source, /creditsUsed/);
  assert.match(source, /balance unchanged|spent \$\{delta\}|spent \${delta}/);
});

test("the catalogue filter rejects a model that is free on tokens but charges for images", () => {
  // Verbatim shape from the live catalogue: zero prompt, zero completion,
  // non-zero image. The previous filter checked only the first two and would
  // have selected this for a mode that sends a screenshot every turn.
  const source = read("lib/models.ts");

  assert.match(source, /costsNothing/, "the filter should be the all-fields one");
  assert.ok(
    !/isZero\(m\.pricing\?\.prompt\) && isZero\(m\.pricing\?\.completion\)/.test(source),
    "the two-field filter must not come back",
  );
});

/* -------------------------------------------------------------------- */
/* What the catalogue filter must and must not exclude                   */
/* -------------------------------------------------------------------- */

test("the filter demands tool calling, and only tool calling", () => {
  const source = read("lib/models.ts");

  /*
   * Two failures, in opposite directions, and the line between them.
   *
   * Requiring `tools` AND `structured_outputs` once cut eleven free vision
   * models to two, one of which was a preview endpoint returning empty replies
   * — a filter strict enough to starve every run while looking principled. The
   * fix was to require neither, which was right at the time because the runner
   * sent neither.
   *
   * It sends `tools` now, on every turn of both action spaces, with
   * `tool_choice: "required"`. So a model without tool support cannot answer at
   * all and must be filtered out. `response_format` is still never sent, so
   * `structured_outputs` must still not be required.
   */
  assert.match(
    source,
    /\.filter\(\(m\) => \(m\.supported_parameters \?\? \[\]\)\.includes\("tools"\)\)/,
    "a model that cannot make a tool call is still offered turns it cannot use",
  );
  assert.ok(
    !/includes\("structured_outputs"\)/.test(source),
    "structured_outputs is required again, and nothing sends response_format",
  );
  assert.ok(
    !/includes\("response_format"\)/.test(source),
    "response_format is required again, and nothing sends it",
  );
});

test("tool_choice stays inside the values OpenRouter documents", () => {
  /*
   * Its accepted values are `none`, `auto`, or an object naming one specific
   * function. `required` is an OpenAI value OpenRouter does not document, and
   * it was being sent here — an undocumented enum through a router that fans
   * out to dozens of providers, which fails on some endpoints and not others
   * for a reason nobody can see from the outside.
   *
   * Naming one function is no use either: choosing the action is the task.
   */
  const source = read("runner/run.ts");

  assert.match(source, /\n\s*tools,\n/, "the request does not carry the action space as tools");
  assert.match(source, /tool_choice: "auto"/, "tool_choice is not the documented default");
  assert.ok(
    !/tool_choice: "required"/.test(source),
    "an undocumented tool_choice value is being sent to every provider",
  );
});

test("a model that answers in prose is measured, not discarded", () => {
  // The consequence of not forcing the call, and the honest handling of it. A
  // model that was handed tools and did not call one is a finding about that
  // model; recording the turn as prose keeps it, and reading nothing would
  // throw it away.
  const source = read("runner/run.ts");

  assert.match(source, /transport: "tool_call" \| "prose"/, "how a turn arrived is not recorded");
  assert.match(source, /reply\.toolCall\s*\?/, "a tool call is not preferred over the text");
  assert.match(source, /parseTurn\(reply\.content\)/, "a prose reply is discarded rather than read");
});

test("an endpoint that refuses tool_choice is retried, not abandoned", () => {
  /*
   * Not every endpoint behind OpenRouter accepts the field. Some reject the
   * value; some fail at the routing layer with "no endpoints found for
   * tool_choice", which arrives as a **404** — and the rule below it treats any
   * 4xx as a malformed request and moves to the next model. So a working
   * endpoint would have been written off over an optional hint, and on a short
   * chain that is the whole chain.
   *
   * The tools are never dropped, only the insistence. A turn without the action
   * space is not a degraded measurement, it is a different one.
   */
  const source = read("runner/run.ts");
  const models = read("lib/models.ts");

  // Behavioural, not just present. A predicate that always answers false still
  // compiles, still exports, and quietly restores the old behaviour.
  assert.equal(
    rejectsToolChoice("No endpoints found that support tool_choice"),
    true,
    "the routing-layer refusal is not recognised",
  );
  assert.equal(
    rejectsToolChoice("Provider returned error: context length exceeded"),
    false,
    "an unrelated failure is being treated as a tool_choice refusal",
  );
  assert.match(models, /export function rejectsToolChoice/, "nothing recognises the refusal");
  assert.match(
    source,
    /response\.status === 404[\s\S]{0,80}rejectsToolChoice/,
    "a 404 about tool_choice is still read as a dead model",
  );
  assert.match(
    source,
    /dropToolChoice \? \{\} : \{ tool_choice: "auto" \}/,
    "the retry does not actually omit the field",
  );
  assert.ok(
    !/dropTools|tools: undefined/.test(source),
    "the action space itself is being dropped, which changes what is measured",
  );
});

test("models that are not assistants are excluded by name", () => {
  const source = read("lib/models.ts");
  const pattern = source.match(/const NOT_AN_ASSISTANT = \/\(([^)]*)\)\//);

  assert.ok(pattern, "the exclusion pattern should exist");
  const expression = new RegExp(`(${pattern[1]})`, "i");

  // Real entries from the live catalogue that reached the chain before this.
  assert.ok(expression.test("nvidia/nemotron-3.5-content-safety:free"));
  assert.ok(expression.test("meta-llama/llama-guard-4-12b"));

  // And ordinary chat models must still get through.
  assert.ok(!expression.test("google/gemma-4-31b-it:free"));
  assert.ok(!expression.test("thinkingmachines/inkling:free"));
  assert.ok(!expression.test("stealth/ox-alpha"));
});

test("media generators are excluded by their output modalities", () => {
  const source = read("lib/models.ts");

  // google/lyria-* is music generation and declares text among its outputs.
  assert.match(source, /!out\.includes\("audio"\) && !out\.includes\("image"\)/);
});

test("preview endpoints are ranked last rather than excluded", () => {
  const source = read("lib/models.ts");
  const pattern = source.match(/preview: \/\(([^)]*)\)\/i/);

  assert.ok(pattern, "the preview signal should exist");
  const expression = new RegExp(`(${pattern[1]})`, "i");

  // The endpoint that returned empty replies while advertising every
  // capability the ranking otherwise rewards.
  assert.ok(expression.test("dots-studio/dots-3-note-preview:free"));
  assert.ok(expression.test("stealth/ox-alpha"));

  // Stable endpoints must not be demoted.
  assert.ok(!expression.test("google/gemma-4-31b-it:free"));
  assert.ok(!expression.test("thinkingmachines/inkling:free"));

  // Ranked, not removed: a preview that works is still worth having.
  assert.match(source, /if \(a\.preview !== b\.preview\)/);
});

test("an endpoint answering with nothing twice is abandoned, not retried three times", () => {
  const source = read("runner/run.ts");

  assert.match(
    source,
    /if \(attempt >= 1\) break;/,
    "two empty replies should move to the next model",
  );
});

/* -------------------------------------------------------------------- */
/* Spending, when it is deliberately asked for                           */
/* -------------------------------------------------------------------- */

test("naming a paid model is not enough on its own — a budget is required too", () => {
  const source = read("runner/run.ts");

  // Forgetting the second half of the decision must not quietly mean unlimited.
  assert.match(source, /PAID && !\(BUDGET > 0\)/);
  assert.match(source, /process\.exit\(2\)/);
});

test("whether a model costs money is read from the catalogue, not its name", () => {
  const source = read("lib/models.ts");

  // The bug this guards: `:free` is a naming convention. stealth/ox-alpha has
  // all-zero pricing and no suffix, so a name-based check called it paid and
  // would have sent it the permissive ceiling instead of the zero one.
  // Anchored to the call parenthesis: without it, `isPaidModelXX` matches too.
  assert.match(source, /export async function isPaidModel\(/);
  assert.match(read("runner/run.ts"), /await isPaidModel\(MODEL\)/, "and it must be called");
  assert.ok(
    !/id\.endsWith\(":free"\)/.test(source),
    "the suffix heuristic must not come back",
  );
  assert.match(source, /return true;/, "an unreachable catalogue means assume paid");
});

test("the budget survives the process restart between tasks", () => {
  const source = read("runner/run.ts");
  const script = read("record-runs.sh");

  // The bug this guards: `spent` was a module-level variable, and the script
  // spawns a fresh node process per task. It reset every time, so BUDGET=0.25
  // across six tasks permitted 1.50 — six times the figure that was set.
  // Precise on purpose: /BUDGET_STATE/ alone still matches `const BUDGET_STATE = ""`,
  // which is the bug wearing the name of the fix.
  assert.match(
    source,
    /BUDGET_STATE = process\.env\.BUDGET_STATE/,
    "the path has to come from the environment, not be blanked out",
  );
  assert.match(source, /readBudgetState/);
  assert.match(source, /writeBudgetState/);
  assert.match(script, /BUDGET_STATE=/, "the script must create one file for the session");
  assert.match(script, /export BUDGET_STATE/);
});

test("the budget does not depend on the provider reporting a per-call cost", () => {
  const source = read("runner/run.ts");

  // The bug this guards: `spent` only grew inside `if (reportedCost > 0)`, so a
  // missing or zero cost field meant the budget never triggered at all.
  assert.match(source, /spentBefore - budgetBaseline/, "anchored to the account total");
  assert.match(source, /Math\.max\(accountSpend, spent\)/, "whichever figure is higher wins");
});

test("a hard request cap bounds the worst case with no cost data at all", () => {
  const source = read("runner/run.ts");

  assert.match(source, /requestCapFor/, "the cap is derived from the task budget");
  assert.match(source, /that is the hard cap/);
  assert.match(source, /requests = 0;/, "and it resets per task, not per process");
});

test("the budget stops a runaway task mid-way, not at the next boundary", () => {
  const source = read("runner/run.ts");

  assert.match(source, /spent \+= reportedCost/);
  assert.match(source, /spent >= BUDGET/);
  assert.match(source, /Stopping mid-run/, "a half-recorded task beats an unbounded bill");
});

test("free runs still refuse to spend anything at all", () => {
  const source = read("runner/run.ts");

  // The zero ceiling and the abort-on-any-charge both survive for free runs.
  assert.match(source, /PAID \? AFFORDABLE : FREE_ONLY/);
  assert.match(source, /if \(!PAID\) \{/);
});

test("a paid run still carries a hard rate ceiling", () => {
  // Its job changes from "never spend" to "never spend a surprising amount":
  // a mistyped id cannot route to a model costing fifty times the intent.
  assert.equal(AFFORDABLE.max_price.prompt, 2);
  assert.equal(AFFORDABLE.max_price.completion, 10);
});

test("a chosen model is never silently swapped for another", () => {
  const source = read("runner/run.ts");

  // Falling back from a paid model the user picked to one they did not would
  // spend their money on a measurement they never asked for.
  assert.match(source, /if \(MODEL !== "openrouter\/free"\) return \[MODEL\];/);
});

test("paid models cannot be selected through the deployed console", () => {
  // The public app must never be able to spend the owner's credits, whoever is
  // signed in. Only the local runner can.
  const source = read("lib/models.ts");
  assert.match(source, /costsNothing\(m\.pricing\)/, "the catalogue the app offers stays free-only");
});

/* -------------------------------------------------------------------- */
/* Reasoning tokens                                                      */
/* -------------------------------------------------------------------- */

test("reasoning defaults to the minimum, not to off", () => {
  const source = read("lib/models.ts");

  // Measured, not assumed: at full effort one turn cost 0.0123 credits, ~6000
  // of them reasoning — about 95% of the spend, to locate a star icon.
  //
  // But `none` is not portable. Gemini 3.7 Flash answers a request to disable
  // reasoning with HTTP 400, "Reasoning is mandatory for this endpoint and
  // cannot be disabled." Asking for the least a model will give works
  // everywhere and costs about the same.
  assert.match(source, /REASONING_EFFORT = process\.env\.REASONING \?\? "minimal"/);
});

test("a model that refuses the reasoning field is retried without it", () => {
  // The bug this guards: a single unsupported parameter produced a 400 that
  // killed the whole run, on a model that works fine without the field set.
  assert.match(read("lib/models.ts"), /export function rejectsReasoning/);

  for (const file of ["runner/run.ts"]) {
    const source = read(file);
    assert.match(source, /rejectsReasoning\(detail\)/, `${file} must detect it`);
    assert.match(source, /dropReasoning = true/, `${file} must retry without it`);
    assert.match(
      source,
      /dropReasoning \? \{\} : reasoningOption\(\)/,
      `${file} must actually omit the field on the retry`,
    );
  }
});

test("a 4xx is not retried into the ground", () => {
  const source = read("runner/run.ts");

  // A malformed request is malformed every time. Before this it burned three
  // attempts and then sent the identical body to the next model.
  assert.match(source, /status >= 400 && response\.status < 500\) break/);
});

test("the response body is kept when a request is rejected", () => {
  // A bare status is not a diagnosis. The provider names the field it objected
  // to — discarding that turned a one-line fix into a probe script.
  for (const file of ["runner/run.ts"]) {
    assert.match(read(file), /await response\.text\(\)/, `${file} must read the error body`);
  }
});

test("reasoning is switched off, not merely hidden", () => {
  const source = read("lib/models.ts");

  // The trap: `exclude: true` hides reasoning from the response and bills for
  // it identically. Only `effort: "none"` stops it being generated.
  assert.match(source, /reasoning: \{ effort: REASONING_EFFORT \}/);

  // Comments are stripped first. The obvious assertion matched the sentence
  // above describing the trap, so it passed while proving nothing about code.
  assert.ok(
    !/exclude:\s*true/.test(withoutComments(source)),
    "exclude does not stop the billing",
  );
});

test("both callers send the reasoning setting", () => {
  for (const file of ["runner/run.ts"]) {
    assert.match(
      read(file),
      /\.\.\.\(dropReasoning \? \{\} : reasoningOption\(\)\)/,
      `${file} must send it unless the model refused it`,
    );
  }
});

test("the runner records which reasoning setting produced a run", () => {
  // A run with reasoning and one without are not the same measurement, so the
  // setting is printed rather than left implicit.
  assert.match(read("runner/run.ts"), /reasoning: \$\{REASONING_EFFORT\}/);
});

test("remaining key credit is not labelled as requests", () => {
  const script = read("record-runs.sh");

  // The bug this guards: a $1 spending cap displayed as "1 requests remaining",
  // read just before deciding whether to start a batch.
  assert.ok(
    !/limit_remaining \+ " requests remaining"/.test(script),
    "limit_remaining is credits, not requests",
  );
  assert.match(script, /of key credit left/);
});

test("a tool result is returned against the call it answers", () => {
  /*
   * The agentic loop, and this was only half of it. The runner sent tools,
   * received `tool_calls`, and then pushed the assistant turn as plain content
   * with the outcome as a `user` message. Two things broke.
   *
   * `content` is empty on a turn that was nothing but a tool call, so the
   * model's own action vanished from its history — asked to continue a
   * conversation in which it could not see what it had done, and left to infer
   * it from the mailbox handed back. And a result delivered as a user message
   * is not a tool result: the protocol pairs it to the call by `tool_call_id`,
   * which is what lets a model attribute an outcome to the thing it did rather
   * than to the turn it happened on.
   *
   * A run passed on the old shape. That is the uncomfortable part — a model
   * compensating for a malformed transcript is still being measured on
   * compensating.
   */
  const source = read("runner/run.ts");

  assert.match(
    source,
    /role: "assistant",\n\s*content: reply\.content \|\| null,\n\s*tool_calls: \[reply\.toolCall\],/,
    "the assistant turn does not carry the call it made",
  );
  assert.match(
    source,
    /role: "tool",\n\s*tool_call_id: reply\.toolCall\.id,/,
    "the outcome is not returned as a tool result against its call",
  );
  assert.match(
    source,
    /tool_call_id\?: string;/,
    "the message shape cannot carry a tool result",
  );
});

test("a model that answered in prose still gets its result", () => {
  // No call means nothing to pair against, so the plain shape is correct for it
  // — and dropping the turn entirely would lose the measurement.
  const source = read("runner/run.ts");
  assert.match(
    source,
    /messages\.push\(\{ role: "assistant", content: reply\.content \}\);\n\s*messages\.push\(\{ role: "user", content: outcome \}\);/,
    "a prose turn is dropped from the transcript instead of being answered",
  );
});
