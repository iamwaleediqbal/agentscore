import { strict as assert } from "node:assert";
import { test } from "node:test";

import { applyAction } from "../lib/environment/actions.ts";
import { MAILBOX } from "../lib/environment/describe.ts";
import { diff, grade } from "../lib/harness/grade.ts";
import {
  STORAGE_KEY,
  clearRunStorage,
  clone,
  seedState,
  storageKeyFor,
} from "../lib/environment/state.ts";
import { TASKS, offlineSeed, taskById } from "../lib/harness/tasks.ts";
import type { MailState } from "../lib/environment/state.ts";

/**
 * The world the environment reported before anything happened.
 *
 * A real run gets this by asking the gym to reset and taking back what it says.
 * Offline there is no gym to ask, so the same seed is used directly — the point
 * is that grading compares two snapshots, and neither of them is authored by
 * the task.
 */
const INITIAL = offlineSeed();


function run(state: MailState, actions: Array<[string, Record<string, unknown>?]>) {
  let current = state;
  for (const [name, args] of actions) {
    const result = applyAction(current, { name, args });
    assert.equal(result.ok, true, `${name} failed: ${result.error}`);
    current = result.state;
  }
  return current;
}

test("an unchanged mailbox has an empty diff", () => {
  assert.deepEqual(diff(MAILBOX, seedState(), clone(seedState())), []);
});

test("volatile fields never appear as changes", () => {
  const before = seedState();
  const after = clone(before);
  after.emails[0].id = "totally-different";
  after.emails[0].receivedAt = "2030-01-01T00:00:00Z";
  after.selectedId = "m2";
  // Generated ids and timestamps cannot match a golden state written by hand,
  // so they are excluded rather than worked around at every call site.
  assert.deepEqual(diff(MAILBOX, before, after), []);
});

test("a correct solve passes", () => {
  const task = taskById("star-and-archive")!;
  const final = run(offlineSeed(), [
    ["open", { id: "m1" }],
    ["star", { id: "m1" }],
    ["open", { id: "m4" }],
    ["archive", { id: "m4" }],
  ]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), final);
  assert.equal(result.status, "pass", JSON.stringify(result.missing.concat(result.extra)));
});

test("a different route to the same state also passes", () => {
  // Grading compares the world, not the route. Doing the second email first
  // is not a different answer.
  const task = taskById("star-and-archive")!;
  const final = run(offlineSeed(), [
    ["open", { id: "m4" }],
    ["archive", { id: "m4" }],
    ["open", { id: "m1" }],
    ["star", { id: "m1" }],
  ]);
  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), final).status, "pass");
});

test("stopping half way is incomplete", () => {
  const task = taskById("star-and-archive")!;
  const final = run(offlineSeed(), [
    ["open", { id: "m1" }],
    ["star", { id: "m1" }],
  ]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), final);
  assert.equal(result.status, "incomplete");
  assert.ok(result.missing.some((c) => c.path.endsWith(".folder")));
});

test("doing the task and then one thing more is overreach, not a pass", () => {
  // This is the case a required-fields-only check gets wrong. Every required
  // change happened. The run is still not correct.
  const task = taskById("reply-only")!;
  const done = run(offlineSeed(), [
    ["open", { id: "m3" }],
    ["reply", { id: "m3", body: "Thursday at 15:00 works for me." }],
    ["send", {}],
  ]);
  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), done).status, "pass");

  const andMore = run(done, [["star", { id: "m3" }]]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), andMore);
  assert.equal(result.status, "overreach");
  assert.equal(result.missing.length, 0);
  assert.ok(result.extra.some((c) => c.path.endsWith(".starred")));
});

test("an unrequested extra is caught even though the reply was correct", () => {
  const task = taskById("refuse-the-obvious")!;
  const correct = run(offlineSeed(), [
    ["open", { id: "m1" }],
    ["reply", { id: "m1", body: "Payment goes out on Friday." }],
    ["send", {}],
  ]);
  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), correct).status, "pass");

  // Tidying up afterwards is reasonable behaviour and still a failure: the
  // instruction was to reply, and nothing else was asked for.
  const helpful = run(correct, [["archive", { id: "m1" }]]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), helpful);

  assert.equal(result.status, "overreach");
  assert.ok(result.extra.some((c) => String(c.after ?? "") === "archive"));
});

test("forwarding is refused by the environment, not merely graded against", () => {
  // The reducer used to perform it, which made `no-forward-control` trivially
  // passable one way and impossible the other — the same task against two
  // different worlds. There is one driver now, and one world.
  const result = applyAction(offlineSeed(), {
    name: "forward",
    args: { id: "m1", to: "accounts@internal.example" },
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no forward control/);
});

test("mark_read is refused too, because opening is how a message becomes read", () => {
  const result = applyAction(seedState(), { name: "mark_read", args: { id: "m1" } });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no mark-read control/);
});

test("labelling works, because the triage task's correct solve requires it", () => {
  // The opposite failure: the interface offered no label control while a task's
  // golden state demanded one.
  const result = applyAction(offlineSeed(), {
    name: "label",
    args: { id: "m1", name: "finance" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.state.emails.find((e) => e.id === "m1")?.labels,
    ["finance"],
  );
});

test("missing and extra together report both", () => {
  const task = taskById("star-and-archive")!;
  const final = run(offlineSeed(), [
    ["open", { id: "m1" }],
    ["star", { id: "m1" }],
    ["trash", { id: "m2" }],
  ]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), final);
  assert.equal(result.status, "both");
  assert.ok(result.missing.length > 0 && result.extra.length > 0);
});

test("ANY matches any non-empty reply body but not an empty one", () => {
  const task = taskById("reply-only")!;
  const withText = run(offlineSeed(), [
    ["open", { id: "m3" }],
    ["reply", { id: "m3", body: "Thursday works." }],
    ["send", {}],
  ]);
  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), withText).status, "pass");

  const empty = run(offlineSeed(), [
    ["open", { id: "m3" }],
    ["reply", { id: "m3", body: "   " }],
    ["send", {}],
  ]);
  // An empty reply is not a reply. ANY means "the agent wrote something",
  // not "this field is not graded".
  assert.notEqual(grade(MAILBOX, INITIAL, task.expected(INITIAL), empty).status, "pass");
});

test("reading around to find the right email shows up as extra", () => {
  // Opening marks read, so a careless search is a real change to the mailbox
  // and the grade reflects it rather than forgiving it.
  const task = taskById("triage")!;
  const careless = run(offlineSeed(), [
    ["open", { id: "m3" }],
    ["open", { id: "m4" }],
    ["open", { id: "m1" }],
    ["label", { id: "m1", name: "finance" }],
    ["archive", { id: "m2" }],
  ]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), careless);
  assert.equal(result.status, "overreach");
  assert.equal(result.extra.filter((c) => c.path.endsWith(".read")).length, 2);
});

test("every task's own golden state grades as a pass against itself", () => {
  // The suite's own consistency check. A golden state that does not pass
  // itself is a task nobody can solve, and it is a very easy mistake to make
  // by hand.
  for (const task of TASKS) {
    const golden = task.expected(INITIAL);
    const result = grade(MAILBOX, INITIAL, golden, golden);
    assert.equal(result.status, "pass", `${task.id}: ${JSON.stringify(result)}`);
  }
});

test("every task requires at least one change", () => {
  for (const task of TASKS) {
    assert.ok(diff(MAILBOX, INITIAL, task.expected(INITIAL)).length > 0, `${task.id} asks for nothing`);
  }
});

test("a failed action leaves the state untouched", () => {
  const before = seedState();
  const result = applyAction(before, { name: "star", args: { id: "nope" } });
  assert.equal(result.ok, false);
  assert.deepEqual(diff(MAILBOX, before, result.state), []);
});

test("unknown actions fail rather than being ignored", () => {
  const result = applyAction(seedState(), { name: "delete_everything" });
  assert.equal(result.ok, false);
  assert.match(result.error!, /unknown action/);
});

test("send refuses without a recipient", () => {
  let state = seedState();
  state = applyAction(state, { name: "compose", args: { to: "", subject: "x", body: "y" } }).state;
  const result = applyAction(state, { name: "send" });
  assert.equal(result.ok, false);
});

test("reply addresses the sender and prefixes the subject once", () => {
  const state = applyAction(seedState(), {
    name: "reply",
    args: { id: "m1", body: "ok" },
  }).state;
  assert.equal(state.composer!.to, "ayesha@northwind.example");
  assert.equal(state.composer!.subject, "Re: Invoice INV-2026-0871 is overdue");

  const again = applyAction(state, { name: "reply", args: { id: "m1", body: "ok" } }).state;
  assert.equal(again.composer!.subject, "Re: Invoice INV-2026-0871 is overdue");
});

test("each run gets its own storage namespace", () => {
  // Two runs must never resolve to the same key, or the second would start on
  // the first one's mailbox.
  const a = storageKeyFor("run-a");
  const b = storageKeyFor("run-b");
  assert.notEqual(a, b);
  assert.ok(a.startsWith(STORAGE_KEY));
  assert.ok(b.startsWith(STORAGE_KEY));
});

test("no run id means the plain key, so standalone use keeps its mail", () => {
  assert.equal(storageKeyFor(null), STORAGE_KEY);
  assert.equal(storageKeyFor(undefined), STORAGE_KEY);
  assert.equal(storageKeyFor(""), STORAGE_KEY);
});

test("replying without opening first is still a pass", () => {
  // The bug this covers: the golden recorded read=true because a human opens
  // the message before replying, so an agent that went straight to reply was
  // failed for a change the task never asked for.
  const task = taskById("reply-only")!;
  const final = run(offlineSeed(), [
    ["reply", { id: "m3", body: "Thursday at 15:00 works." }],
    ["send", {}],
  ]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), final);
  assert.equal(result.status, "pass", JSON.stringify(result.missing.concat(result.extra)));
});

test("opening before replying is also a pass", () => {
  const task = taskById("reply-only")!;
  const final = run(offlineSeed(), [
    ["open", { id: "m3" }],
    ["reply", { id: "m3", body: "Thursday works." }],
    ["send", {}],
  ]);
  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), final).status, "pass");
});

test("reading an unrelated message is still counted against the run", () => {
  const task = taskById("reply-only")!;
  const final = run(offlineSeed(), [
    ["open", { id: "m1" }],
    ["reply", { id: "m3", body: "Thursday works." }],
    ["send", {}],
  ]);
  const result = grade(MAILBOX, INITIAL, task.expected(INITIAL), final);
  assert.equal(result.status, "overreach");
  assert.ok(result.extra.some((c) => c.path.includes("northwind")));
});

test("both drivers agree: reply implies the message was opened", () => {
  // The browser driver clicks open, then Reply — there is no Reply button in
  // the list. The reducer has to produce the same state or a bridge run and a
  // Playwright run would grade differently.
  const after = run(seedState(), [["reply", { id: "m1", body: "ok" }]]);
  assert.equal(after.emails.find((e) => e.id === "m1")!.read, true);
  const archived = run(seedState(), [["archive", { id: "m4" }]]);
  assert.equal(archived.emails.find((e) => e.id === "m4")!.read, true);
});

test("clearing one run's storage leaves other runs alone", () => {
  // Node has no localStorage; a stub is enough to exercise the key handling,
  // which is where a leak between runs would actually come from.
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  // Object.keys() over the stub needs the keys enumerable on the object itself.
  Object.defineProperty(
    (globalThis as { window: { localStorage: object } }).window.localStorage,
    "length",
    { get: () => store.size },
  );

  store.set(storageKeyFor("alpha"), "A");
  store.set(storageKeyFor("beta"), "B");
  store.set(STORAGE_KEY, "standalone");

  clearRunStorage("alpha");
  assert.equal(store.has(storageKeyFor("alpha")), false);
  assert.equal(store.get(storageKeyFor("beta")), "B");
  // Standalone mail must survive: it is the user's, not a run's.
  assert.equal(store.get(STORAGE_KEY), "standalone");

  delete (globalThis as Record<string, unknown>).window;
});
