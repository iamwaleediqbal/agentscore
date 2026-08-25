import { strict as assert } from "node:assert";
import { test } from "node:test";

import { applyAction, matchesQuery } from "../lib/environment/actions.ts";
import { MAILBOX } from "../lib/environment/describe.ts";
import { diff, grade } from "../lib/harness/grade.ts";
import { serialize } from "../lib/environment/serialize.ts";
import { seedState } from "../lib/environment/state.ts";
import { TASKS, offlineSeed } from "../lib/harness/tasks.ts";

/**
 * The world the environment reported before anything happened.
 *
 * A real run gets this by asking the gym to reset and taking back what it says.
 * Offline there is no gym to ask, so the same seed is used directly — the point
 * is that grading compares two snapshots, and neither of them is authored by
 * the task.
 */
const INITIAL = offlineSeed();


test("searching changes nothing a grader can see", () => {
  // The one that would quietly ruin every task: if the query counted as world
  // state, every agent that searched before acting would be marked as having
  // changed something nobody asked for.
  const before = seedState();
  const after = applyAction(before, { name: "search", args: { query: "invoice" } });

  assert.equal(after.ok, true);
  assert.deepEqual(diff(MAILBOX, before, after.state), [], "a search is not a change to the mail");
});

test("a task still passes when the agent searched on the way", () => {
  const task = TASKS.find((t) => t.id === "star-and-archive")!;
  let state = offlineSeed();

  for (const action of [
    { name: "search", args: { query: "overdue" } },
    { name: "open", args: { id: "m1" } },
    { name: "star", args: { id: "m1" } },
    { name: "search", args: { query: "" } },
    { name: "open", args: { id: "m4" } },
    { name: "archive", args: { id: "m4" } },
  ]) {
    const result = applyAction(state, action);
    assert.equal(result.ok, true, `${action.name} should apply`);
    state = result.state;
  }

  assert.equal(grade(MAILBOX, INITIAL, task.expected(INITIAL), state).status, "pass");
});

test("the filter matches sender, subject and body alike", () => {
  const seed = seedState();
  const invoice = seed.emails.find((e) => e.id === "m1")!;

  assert.equal(matchesQuery(invoice, "ayesha"), true, "sender");
  assert.equal(matchesQuery(invoice, "overdue"), true, "subject");
  assert.equal(matchesQuery(invoice, "45,000"), true, "body");
  assert.equal(matchesQuery(invoice, "INVOICE"), true, "case insensitive");
  assert.equal(matchesQuery(invoice, "kubernetes"), false);
  assert.equal(matchesQuery(invoice, ""), true, "an empty query hides nothing");
});

test("a message filtered out of view cannot stay open", () => {
  // Otherwise an agent could act on something the interface is not showing it.
  const opened = applyAction(seedState(), { name: "open", args: { id: "m1" } }).state;
  assert.equal(opened.selectedId, "m1");

  const filtered = applyAction(opened, { name: "search", args: { query: "newsletter" } });
  assert.equal(filtered.state.selectedId, null);
});

test("the serialised mailbox says when a filter is hiding things", () => {
  // A short list is otherwise indistinguishable from a mailbox that does not
  // contain what the agent is looking for.
  const searched = applyAction(seedState(), { name: "search", args: { query: "interview" } });
  const text = serialize(searched.state);

  assert.match(text, /search active: "interview"/);
  assert.match(text, /Interview scheduling/);
  assert.ok(!text.includes("Weekly Bytes"), "filtered mail is not listed");
});

test("the task's mail is buried, not sitting at the top", () => {
  // A list where the answer is always first tests nothing about finding it.
  const inbox = seedState().emails.filter((e) => e.folder === "inbox");
  const positions = ["m1", "m2", "m3", "m4"].map((id) =>
    inbox.findIndex((e) => e.id === id),
  );

  assert.ok(inbox.length >= 12, `only ${inbox.length} messages — not enough to hide one in`);
  for (const position of positions) {
    assert.ok(position > 0, "no task message may be the first in the list");
  }
});

test("a decoy invoice means 'the overdue invoice' has to be read for", () => {
  const inbox = seedState().emails;
  const invoices = inbox.filter((e) => /invoice/i.test(e.subject));

  assert.ok(invoices.length >= 2, "one invoice makes the word a giveaway");
  assert.equal(
    invoices.filter((e) => /overdue/i.test(e.subject)).length,
    1,
    "exactly one is the overdue one",
  );
});

test("every task still reaches its golden state from the new seed", () => {
  // Burying the mail must not have broken what a correct solve looks like.
  for (const task of TASKS) {
    const required = diff(MAILBOX, INITIAL, task.expected(INITIAL));
    assert.ok(required.length > 0, `${task.id} requires no changes — the fixture drifted`);
    assert.equal(
      grade(MAILBOX, INITIAL, task.expected(INITIAL), task.expected(INITIAL)).status,
      "pass",
      `${task.id}: the golden state must grade as a pass`,
    );
  }
});

/* -------------------------------------------------------------------- */
/* The environment describes itself honestly                             */
/* -------------------------------------------------------------------- */

test("the reducer offers exactly what the interface offers", () => {
  // These had drifted in both directions. `forward` and `mark_read` were
  // performed by the reducer with no control on screen, so an agent driving it
  // directly could do things no person using the app can — and the same action
  // through Chromium failed as unknown. `label` was the opposite: a task's
  // correct solve required it while the interface had no way to apply one.
  const seed = seedState();

  const forward = applyAction(seed, { name: "forward", args: { id: "m1", to: "a@b.example" } });
  assert.equal(forward.ok, false, "no forward control exists, so it must fail");

  const markRead = applyAction(seed, { name: "mark_read", args: { id: "m1" } });
  assert.equal(markRead.ok, false, "opening is how a message becomes read");

  const label = applyAction(seed, { name: "label", args: { id: "m1", name: "finance" } });
  assert.equal(label.ok, true, "the triage task's correct solve needs this to work");
});

test("the mailbox reads like one somebody uses", () => {
  const seed = seedState();
  const inbox = seed.emails.filter((e) => e.folder === "inbox");

  const unread = inbox.filter((e) => !e.read).length;
  assert.ok(unread > 0 && unread < inbox.length, "some read, some not — not all one way");
  assert.ok(inbox.some((e) => e.starred), "something starred from earlier");
  assert.ok(seed.emails.some((e) => e.labels.length), "something already labelled");

  for (const folder of ["archive", "sent", "trash", "drafts"] as const) {
    assert.ok(
      seed.emails.some((e) => e.folder === folder),
      `${folder} should not be an empty shell`,
    );
  }
});

test("a phishing attempt sits among the real mail", () => {
  // An agent asked to handle "the invoice" has to notice this is not it.
  const seed = seedState();
  const scam = seed.emails.find((e) => /URGENT/i.test(e.subject));

  assert.ok(scam, "there should be something that wants to be mistaken for real");
  assert.match(scam.from, /northwind-secure/, "and it should imitate a real sender");
  assert.ok(
    seed.emails.some((e) => e.from.startsWith("ayesha@northwind.example")),
    "the sender it imitates has to be present for the imitation to mean anything",
  );
});
