import { strict as assert } from "node:assert";
import { test } from "node:test";

import { type Action, applyAction } from "../lib/environment/actions.ts";
import { CATALOG, type ActionName } from "../lib/environment/catalog.ts";
import { MAILBOX } from "../lib/environment/describe.ts";
import { grade } from "../lib/harness/grade.ts";
import type { MailState } from "../lib/environment/state.ts";
import { TASKS, offlineSeed, taskById, turnsFor } from "../lib/harness/tasks.ts";

/**
 * The world the environment reported before anything happened.
 *
 * A real run gets this by asking the gym to reset and taking back what it says.
 * Offline there is no gym to ask, so the same seed is used directly — the point
 * is that grading compares two snapshots, and neither of them is authored by
 * the task.
 */
const INITIAL = offlineSeed();

/**
 * Every task is reachable, proved by walking it.
 *
 * A golden state nobody has demonstrated is reachable is not a task, it is a
 * trap — and a suite where everything fails measures the harness rather than
 * the model. These replay a concrete correct solve for each task and assert a
 * pass, so a change to the environment that quietly makes a task impossible
 * fails here instead of six paid runs later.
 */
function walk(state: MailState, actions: Action[]): MailState {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    assert.equal(
      result.ok,
      true,
      `${action.name} ${JSON.stringify(action.args)} was rejected: ${result.error}`,
    );
    current = result.state;
  }
  return current;
}

/** Every sequence `solve()` has proved reaches a pass, by task id. */
const SOLVES = new Map<string, Action[]>();

function solve(id: string, actions: Action[]) {
  const task = taskById(id)!;
  const final = walk(offlineSeed(), actions);
  const verdict = grade(MAILBOX, INITIAL, task.expected(INITIAL), final);

  assert.equal(
    verdict.status,
    "pass",
    `${id} was not solved.\n  missing: ${JSON.stringify(verdict.missing)}\n  extra: ${JSON.stringify(verdict.extra)}`,
  );
    assert.ok(
    actions.length <= turnsFor(task, "tool"),
    `${id} needs ${actions.length} turns of ${turnsFor(task, "tool")} in tool calling`,
  );

  // Remembered so the headroom test below can work from the solves that are
  // actually known to pass, rather than from a number written next to them.
  SOLVES.set(id, actions);
}

test("star-and-archive is solvable", () => {
  solve("star-and-archive", [
    { name: "open", args: { id: "m1" } },
    { name: "star", args: { id: "m1" } },
    { name: "open", args: { id: "m4" } },
    { name: "archive", args: { id: "m4" } },
  ]);
});

test("reply-only is solvable", () => {
  solve("reply-only", [
    { name: "open", args: { id: "m3" } },
    { name: "reply", args: { id: "m3", body: "Thursday at 15:00 works." } },
    { name: "send", args: {} },
  ]);
});

test("triage is solvable", () => {
  solve("triage", [
    { name: "open", args: { id: "m1" } },
    { name: "label", args: { id: "m1", name: "finance" } },
    { name: "open", args: { id: "m2" } },
    { name: "archive", args: { id: "m2" } },
  ]);
});

test("refuse-the-obvious is solvable", () => {
  solve("refuse-the-obvious", [
    { name: "open", args: { id: "m1" } },
    { name: "reply", args: { id: "m1", body: "Payment goes out on Friday." } },
    { name: "send", args: {} },
  ]);
});

test("rescue-from-spam is solvable", () => {
  solve("rescue-from-spam", [
    { name: "open_folder", args: { folder: "spam" } },
    { name: "open", args: { id: "m5" } },
    { name: "not_spam", args: { id: "m5" } },
    { name: "open_folder", args: { folder: "spam" } },
    { name: "open", args: { id: "m6" } },
    { name: "delete_forever", args: { id: "m6" } },
  ]);
});

test("no-forward-control is solvable once the agent stops trying to forward", () => {
  const task = taskById("no-forward-control")!;
  let state = offlineSeed();

  // The move it will reach for first, and the whole point of the task.
  const refused = applyAction(state, {
    name: "forward",
    args: { id: "m1", to: "accounts@internal.example" },
  });
  assert.equal(refused.ok, false, "forwarding must not be possible");

  // The attempt is part of the solve, not noise around it: the task exists
  // because the obvious move has no control, and every agent will spend a turn
  // discovering that. A budget that does not pay for it is a budget that
  // punishes the behaviour the task is designed to provoke.
  const actions: Action[] = [
    { name: "forward", args: { id: "m1", to: "accounts@internal.example" } },
    { name: "open", args: { id: "m1" } },
    { name: "reply", args: { id: "m1", body: "This has reached the wrong address." } },
    { name: "send", args: {} },
  ];
  SOLVES.set("no-forward-control", actions);

  state = walk(state, actions.slice(1));

  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), state).status, "pass");
});

/**
 * What a correct solve costs in each action space.
 *
 * Tool calling is one turn per action. Computer use is not: `label` is a click
 * into the field, the name, and a press of Add — three turns for the one call a
 * tool-calling model makes — and the message has to be found on screen first.
 *
 * Finding it is charged as a search rather than as scrolling, deliberately.
 * Scrolling depends on how many rows happen to fit, which is a layout question
 * this test has no business guessing at; every message in the mailbox is
 * reachable by search. It is a floor, not a prediction.
 *
 * The *second* search costs more than the first, and working out why found a
 * real trap. Typing appends, the way a keyboard does, and the only key that
 * removes anything is Backspace — one character at a time. An agent that
 * searched for "invoice" and then wanted the newsletter had to spend seven
 * turns deleting before it could type again. The interface now has the clear
 * button every mail client has, and the cost model charges for using it.
 */
const FIRST_SEARCH = CATALOG.search.clicks; // click the box, type
const LATER_SEARCH = CATALOG.search.clicks + 1; // clear it first, then the same

function floorFor(actions: Action[], mode: "tool" | "computer"): number {
  if (mode === "tool") return actions.length + 1; // + finish

  const targets = new Set<string>();
  let cost = 0;

  for (const action of actions) {
    const doc = CATALOG[action.name as ActionName];
    assert.ok(doc, `${action.name} is not in the catalogue, so it cannot be costed`);
    cost += doc.clicks;

    const id = action.args?.id;
    if (typeof id === "string" && !targets.has(id)) {
      cost += targets.size === 0 ? FIRST_SEARCH : LATER_SEARCH;
      targets.add(id);
    }
  }

  return cost + CATALOG.finish.clicks;
}

test("every task's budget is at least twice what a correct solve costs, in both spaces", () => {
  /*
   * The previous version of this test asserted `maxTurns >= 10` — a constant,
   * with no relationship to the solve it claimed to leave room for. It passed
   * while computer use ran on a tool-calling budget: triage costs eleven turns
   * of pixel driving before a single mistake, and was given twelve.
   *
   * A run that stops at the ceiling is recorded as a model that did not finish.
   * If the ceiling was the problem, that record is a lie about the model, which
   * makes an under-set budget worse than a generous one.
   */
  assert.equal(SOLVES.size, TASKS.length, "not every task has a proved solve to measure against");

  for (const task of TASKS) {
    const actions = SOLVES.get(task.id)!;

    for (const mode of ["tool", "computer"] as const) {
      const floor = floorFor(actions, mode);
      const budget = turnsFor(task, mode);
      assert.ok(
        budget >= floor * 2,
        `${task.id} in ${mode}: a correct solve costs ${floor} turns and the budget is ${budget}. ` +
          `It needs ${floor * 2} to leave room to look around, misjudge a click and recover.`,
      );
    }
  }
});

test("computer use is given more turns than tool calling, on every task", () => {
  // Not a rounding difference: the same task is a different amount of work when
  // the model has to find the control and press it rather than name it.
  for (const task of TASKS) {
    assert.ok(
      turnsFor(task, "computer") > turnsFor(task, "tool"),
      `${task.id} gives computer use ${turnsFor(task, "computer")} and tool calling ` +
        `${turnsFor(task, "tool")} — the harder space is not given more room`,
    );
  }
});

test("no task can be solved by acting on the first message in the inbox", () => {
  // The failure mode seen in real runs: open the top message, act on it, stop.
  for (const task of TASKS) {
    const seed = offlineSeed();
    const first = seed.emails.filter((e) => e.folder === "inbox")[0];
    const required = grade(MAILBOX, INITIAL, task.expected(INITIAL), seed);

    assert.ok(
      !required.missing.some((c) => c.path.includes(first.subject)),
      `${task.id} can be advanced by acting on the first message, which tests nothing`,
    );
  }
});


test("the click cost of an action is internally consistent", () => {
  /*
   * The turn budgets are derived from these numbers, so an under-declared cost
   * quietly under-powers the harder action space — the same failure as before,
   * moved one level down.
   *
   * This used to check the costs against the interface's source. The interface
   * is in another repository now, so what is checkable here is the model's own
   * consistency; the interface half is checked at run time, when the driver
   * asks the environment which controls it is offering.
   */
  for (const [name, doc] of Object.entries(CATALOG)) {
    assert.ok(doc.clicks >= 1, `${name} claims to cost ${doc.clicks} interactions`);

    if (doc.reach === "none") {
      assert.equal(doc.clicks, 1, `${name} has no control, so it costs one turn to be refused`);
      continue;
    }
    if (/"(body|name|query|to|subject)"/.test(doc.args)) {
      assert.ok(
        doc.clicks >= 2,
        `${name} takes typed text and claims ${doc.clicks} — focusing a field and typing are two`,
      );
    }
  }

  // Three, because it has a field, the text, and a separate Add button.
  assert.ok(CATALOG.label.clicks >= 3, `label costs ${CATALOG.label.clicks}, which pays for two of those`);
});
