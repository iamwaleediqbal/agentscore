import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ACTION_NAMES, applyAction } from "../lib/environment/actions.ts";
import { FOLDER_ORDER, type Folder, type MailState, clone, seedState } from "../lib/environment/state.ts";

/**
 * Every action, against every folder, plus everything a model might send that
 * is not an action at all.
 *
 * The other tests in this suite drive the reducer along the routes a correct
 * solve takes. This one drives it along the rest: `not_spam` on a message in
 * the archive, `restore` on something that was never in the trash,
 * `delete_forever` from the inbox, `star` with no id, `open` with a number.
 *
 * A model will do all of these. It is what a model does on the turn it has
 * misread which folder it is in, and the environment's answer has to be a clean
 * refusal rather than a half-applied mutation or a thrown exception — a throw
 * ends a paid run, and a half-applied mutation continues it from a world nobody
 * described.
 */

function base(): MailState {
  return { ...seedState(), folder: "inbox", query: "", selectedId: null, composer: null };
}

/** One message that really is in each folder, so the matrix is not vacuous. */
function idIn(state: MailState, folder: Folder): string {
  const email = state.emails.find((e) => e.folder === folder);
  assert.ok(email, `the seed has nothing in ${folder}, so the matrix would not test it`);
  return email.id;
}

/* ------------------------------------------------------------------ */
/* The matrix                                                          */
/* ------------------------------------------------------------------ */

/**
 * Which (action, folder) pairs are allowed to succeed.
 *
 * Written out rather than derived, deliberately. Derived from the reducer it
 * would agree with the reducer by construction and prove nothing; written out,
 * it is a second statement of the rules that has to be changed on purpose.
 */
const ALLOWED: Record<string, (folder: Folder) => boolean> = {
  open_folder: () => true,
  open: () => true,
  search: () => true,
  star: () => true,
  unstar: () => true,
  mark_read: () => false, // no control exists; opening is how a message is read
  mark_unread: () => true,
  archive: () => true,
  trash: () => true,
  spam: (f) => f !== "spam", // already there
  not_spam: (f) => f === "spam",
  restore: (f) => f === "trash",
  delete_forever: (f) => f === "spam" || f === "trash",
  label: () => true,
  compose: () => true,
  reply: () => true,
  forward: () => false, // no control exists
  send: () => false, // nothing is composed in this fixture
  save_draft: () => false, // likewise: there is no draft open to file
  discard: () => true,
  finish: () => true,
};

test("every action against every folder gives the documented answer", () => {
  for (const name of ACTION_NAMES) {
    for (const folder of FOLDER_ORDER) {
      const state = base();
      const id = idIn(state, folder);
      const args: Record<string, unknown> = { id };
      if (name === "open_folder") args.folder = folder;
      if (name === "label") args.name = "finance";
      if (name === "search") args.query = "invoice";
      if (name === "reply" || name === "compose") args.body = "a reply";
      if (name === "compose") args.to = "someone@example.com";

      let ok: boolean | undefined;
      let why: string | undefined;
      assert.doesNotThrow(() => {
        const result = applyAction(state, { name, args });
        ok = result.ok;
        why = result.error;
      }, `${name} on a message in ${folder} threw instead of answering`);

      assert.equal(
        ok,
        ALLOWED[name]!(folder),
        `${name} on a message in ${folder}: expected ok=${ALLOWED[name]!(folder)}, got ${ok}` +
          (why ? ` (${why})` : ""),
      );
    }
  }
});

test("the matrix covers every action the reducer accepts", () => {
  // Otherwise adding an action silently escapes the matrix above.
  for (const name of ACTION_NAMES) {
    assert.ok(name in ALLOWED, `${name} is not in the matrix, so nothing checks it`);
  }
  for (const name of Object.keys(ALLOWED)) {
    assert.ok(
      (ACTION_NAMES as readonly string[]).includes(name),
      `the matrix describes ${name}, which the reducer no longer accepts`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Properties that must hold whatever the action was                   */
/* ------------------------------------------------------------------ */

function* everyMove(): Generator<{ state: MailState; name: string; args: Record<string, unknown> }> {
  for (const name of ACTION_NAMES) {
    for (const folder of FOLDER_ORDER) {
      const state = base();
      yield {
        state,
        name,
        args: {
          id: idIn(state, folder),
          folder,
          name: "finance",
          query: "invoice",
          to: "someone@example.com",
          body: "a reply",
        },
      };
    }
  }
}

test("a refused action leaves the mailbox byte-for-byte unchanged", () => {
  for (const { state, name, args } of everyMove()) {
    const before = JSON.stringify(state);
    const result = applyAction(state, { name, args });
    if (result.ok) continue;
    assert.equal(
      JSON.stringify(result.state),
      before,
      `${name} was refused but still changed the mailbox — the run would continue from a world nobody described`,
    );
  }
});

test("the reducer never mutates the state it was handed", () => {
  // The caller keeps the previous state to diff against. If the reducer edits
  // it in place, the diff is computed against the answer and every run passes.
  for (const { state, name, args } of everyMove()) {
    const before = JSON.stringify(state);
    applyAction(state, { name, args });
    assert.equal(JSON.stringify(state), before, `${name} mutated its input`);
  }
});

test("only send adds mail and only delete_forever removes it", () => {
  for (const { state, name, args } of everyMove()) {
    const result = applyAction(state, { name, args });
    const delta = result.state.emails.length - state.emails.length;
    if (name === "send") continue; // nothing is composed here, so it refuses anyway
    if (name === "delete_forever") {
      assert.ok(delta === 0 || delta === -1, `delete_forever changed the count by ${delta}`);
      continue;
    }
    assert.equal(delta, 0, `${name} changed how much mail exists (${delta})`);
  }
});

test("every message stays in a folder that exists", () => {
  for (const { state, name, args } of everyMove()) {
    const result = applyAction(state, { name, args });
    for (const email of result.state.emails) {
      assert.ok(
        FOLDER_ORDER.includes(email.folder),
        `${name} left ${email.id} in "${email.folder}", which is not a folder`,
      );
    }
  }
});

test("what is open is always something that still exists", () => {
  for (const { state, name, args } of everyMove()) {
    const result = applyAction(state, { name, args });
    const open = result.state.selectedId;
    if (open === null) continue;
    assert.ok(
      result.state.emails.some((e) => e.id === open),
      `${name} left ${open} open after it stopped existing`,
    );
  }
});

test("ids stay unique, including after mail is sent and deleted", () => {
  // The failure this exists for: ids derived from the array length collide as
  // soon as anything has been deleted, and two messages sharing one id means
  // every later action lands on whichever the reducer happens to find first.
  let state = base();

  const send = (to: string) => {
    state = applyAction(state, { name: "compose", args: { to, subject: "s", body: "b" } }).state;
    const result = applyAction(state, { name: "send", args: {} });
    assert.ok(result.ok, "send was refused");
    state = result.state;
  };

  send("one@example.com");
  const spam = state.emails.find((e) => e.folder === "spam")!;
  const gone = applyAction(state, { name: "delete_forever", args: { id: spam.id } });
  assert.ok(gone.ok, "delete_forever was refused");
  state = gone.state;
  send("two@example.com");

  const ids = state.emails.map((e) => e.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicates, [], `two messages share an id: ${duplicates.join(", ")}`);
});

/* ------------------------------------------------------------------ */
/* What a model sends when it is confused                              */
/* ------------------------------------------------------------------ */

const MALFORMED: Array<[string, unknown]> = [
  ["no args at all", undefined],
  ["empty args", {}],
  ["a null id", { id: null }],
  ["a numeric id", { id: 42 }],
  ["an array id", { id: ["m1"] }],
  ["an object id", { id: { id: "m1" } }],
  ["an id that does not exist", { id: "definitely-not-here" }],
  ["an empty id", { id: "" }],
  ["a folder that does not exist", { id: "m1", folder: "banana" }],
  ["a null folder", { id: "m1", folder: null }],
  ["a numeric query", { id: "m1", query: 7 }],
  ["a label made of spaces", { id: "m1", name: "   " }],
  ["a very long string", { id: "m1", name: "x".repeat(10_000), body: "y".repeat(10_000) }],
];

test("nothing a confused model can send makes the environment throw", () => {
  for (const name of ACTION_NAMES) {
    for (const [label, args] of MALFORMED) {
      const state = base();
      const before = JSON.stringify(state);
      let ok: boolean | undefined;
      let why: string | undefined;
      let after: string | undefined;

      assert.doesNotThrow(() => {
        const result = applyAction(state, { name, args: args as Record<string, unknown> });
        ok = result.ok;
        why = result.error;
        after = JSON.stringify(result.state);
      }, `${name} with ${label} threw, which ends the run`);

      if (ok === false) {
        assert.equal(after, before, `${name} with ${label} was refused but still changed the mailbox`);
        assert.ok(why, `${name} with ${label} failed without saying why`);
      }
      assert.equal(JSON.stringify(state), before, `${name} with ${label} mutated its input`);
    }
  }
});

test("an action name that is not an action is refused, not ignored", () => {
  const state = base();
  for (const name of ["", "delete", "Star", "star ", "open_email", "__proto__", "toString"]) {
    const result = applyAction(state, { name, args: { id: "m1" } });
    assert.equal(result.ok, false, `"${name}" was accepted as an action`);
    assert.ok(result.error?.includes("unknown action"), `"${name}" failed for the wrong reason`);
  }
});

test("nothing about the mailbox survives a clone", () => {
  // clone() is what makes the no-mutation property above hold. If it ever
  // becomes a shallow copy, every test that relies on it quietly stops testing.
  const state = base();
  const copy = clone(state);
  copy.emails[0]!.subject = "changed";
  copy.emails[0]!.labels.push("changed");
  assert.notEqual(state.emails[0]!.subject, "changed", "clone shares email objects");
  assert.deepEqual(state.emails[0]!.labels, [], "clone shares label arrays");
});

/*
 * Saving a draft.
 *
 * The Save button used to dispatch `compose`, which writes the text into the
 * open composer and leaves it there. Nothing reached the drafts folder, the
 * count on the rail did not move, and Discard threw the work away — so a
 * person clicking Save saw the app do nothing, and an agent asked to save a
 * draft changed only a transient blob the next action cleared.
 */
test("saving a draft files it in drafts and closes the composer", () => {
  const opened = applyAction(base(), {
    name: "compose",
    args: { to: "ayesha@northwind.example", subject: "Payment Friday", body: "Going out Friday." },
  });
  assert.equal(opened.ok, true);

  const before = opened.state.emails.filter((e) => e.folder === "drafts").length;
  const saved = applyAction(opened.state, { name: "save_draft", args: {} });
  assert.equal(saved.ok, true, "save_draft was refused with a draft open");

  const drafts = saved.state.emails.filter((e) => e.folder === "drafts");
  assert.equal(drafts.length, before + 1, "the draft did not reach the drafts folder");

  const filed = drafts.find((e) => e.subject === "Payment Friday");
  assert.ok(filed, "the saved draft is not the one that was written");
  assert.equal(filed.to, "ayesha@northwind.example");
  assert.equal(filed.body, "Going out Friday.");
  assert.equal(filed.folder, "drafts");

  assert.equal(saved.state.composer, null, "the composer stayed open after saving");
});

test("a saved draft survives the composer closing, which is the whole point", () => {
  // A change to `composer` is gone the moment the composer closes, and a
  // verdict cannot be computed from something absent from the final snapshot.
  const opened = applyAction(base(), {
    name: "compose",
    args: { to: "a@b.example", subject: "Later", body: "…" },
  });
  const saved = applyAction(opened.state, { name: "save_draft", args: {} });
  const after = applyAction(saved.state, { name: "discard", args: {} });

  assert.ok(
    after.state.emails.some((e) => e.folder === "drafts" && e.subject === "Later"),
    "discarding after saving threw the saved draft away",
  );
});

test("an empty draft is refused rather than filed", () => {
  const opened = applyAction(base(), { name: "compose", args: {} });
  const saved = applyAction(opened.state, { name: "save_draft", args: {} });

  assert.equal(saved.ok, false, "an empty draft was filed");
  assert.ok(saved.state.composer, "a refused save closed the composer and lost the draft");
});

test("save_draft with nothing open is refused, not a crash", () => {
  const saved = applyAction(base(), { name: "save_draft", args: {} });
  assert.equal(saved.ok, false);
});

test("draft ids stay unique after one is deleted", () => {
  // The same collision `send` has: save, delete, save again, and the length is
  // back where it started, so a counted id repeats and every later action lands
  // on whichever message `find` happens to reach first.
  let state = base();
  for (const subject of ["One", "Two"]) {
    state = applyAction(state, { name: "compose", args: { to: "a@b.example", subject, body: "x" } }).state;
    state = applyAction(state, { name: "save_draft", args: {} }).state;
  }

  const first = state.emails.find((e) => e.subject === "One");
  assert.ok(first);
  state = applyAction(state, { name: "open", args: { id: first.id } }).state;
  state = applyAction(state, { name: "trash", args: { id: first.id } }).state;
  state = applyAction(state, { name: "delete_forever", args: { id: first.id } }).state;

  state = applyAction(state, { name: "compose", args: { to: "a@b.example", subject: "Three", body: "x" } }).state;
  state = applyAction(state, { name: "save_draft", args: {} }).state;

  const ids = state.emails.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "two messages share an id");
});
