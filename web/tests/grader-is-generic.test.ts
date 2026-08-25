import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { MAILBOX } from "../lib/environment/describe.ts";
import { ANY, type Describable, diff, grade } from "../lib/harness/grade.ts";

/**
 * The grader belongs to the harness, and this file is what makes that a fact
 * rather than a claim about where a file happens to sit.
 *
 * It used to live in `lib/environment/` typed against `MailState`, which said something
 * untrue about the architecture: that grading is a property of the mail app.
 * The consequence was not cosmetic. Read that way, the whole project looks like
 * it can only ever grade this one toy, and the interesting question — can this
 * be pointed at a real application — reads as out of scope.
 *
 * So the same functions are used below on an environment that has nothing to do
 * with mail. If they ever stop working on it, the grader has grown a dependency
 * on the mailbox again and the seam is gone.
 */

/* ------------------------------------------------------------------ */
/* An environment that is not a mailbox                                */
/* ------------------------------------------------------------------ */

interface Doc {
  path: string;
  content: string;
  savedAt: string;
}
interface Editor {
  docs: Doc[];
  cursor: string | null;
}

/** Forty lines, and a completely different application. That is the point. */
const EDITOR: Describable<Editor> = {
  id: "toy-editor",
  volatile: [/\.savedAt$/, /^cursor$/],
  subjectOf: (p) => p.slice(0, p.lastIndexOf(")") + 1 || p.length),
  flatten(state) {
    const out = new Map<string, unknown>();
    for (const doc of [...state.docs].sort((a, b) => a.path.localeCompare(b.path))) {
      out.set(`doc(${doc.path}).content`, doc.content);
      out.set(`doc(${doc.path}).savedAt`, doc.savedAt);
    }
    out.set("cursor", state.cursor);
    return out;
  },
};

const seed: Editor = {
  docs: [
    { path: "notes.md", content: "one", savedAt: "t0" },
    { path: "todo.md", content: "buy milk", savedAt: "t0" },
  ],
  cursor: null,
};

const edit = (state: Editor, file: string, content: string): Editor => ({
  ...state,
  docs: state.docs.map((d) => (d.path === file ? { ...d, content, savedAt: "t1" } : d)),
});

test("the same grader works on an application that is not a mailbox", () => {
  const golden = edit(seed, "todo.md", "buy oat milk");

  assert.equal(grade(EDITOR, seed, golden, golden).status, "pass");
  assert.equal(grade(EDITOR, seed, golden, seed).status, "incomplete");
});

test("overreach is caught in the other environment too, not just in mail", () => {
  // The distinction the whole grader exists to make, made somewhere else.
  const golden = edit(seed, "todo.md", "buy oat milk");
  const andThenSome = edit(golden, "notes.md", "tidied this up as well");

  const verdict = grade(EDITOR, seed, golden, andThenSome);
  assert.equal(verdict.status, "overreach");
  assert.deepEqual(
    verdict.extra.map((c) => c.path),
    ["doc(notes.md).content"],
  );
});

test("each environment's volatile paths are its own", () => {
  // `savedAt` moves on its own here, exactly as `receivedAt` does in the
  // mailbox — and neither file knows about the other's field names.
  const touched = edit(seed, "todo.md", "buy oat milk");
  assert.ok(
    !diff(EDITOR, seed, touched).some((c) => c.path.endsWith(".savedAt")),
    "a volatile path was reported as a change",
  );
  assert.ok(diff(EDITOR, seed, touched).some((c) => c.path.endsWith(".content")));
});

test("ANY belongs to grading, so it works wherever grading does", () => {
  // Modelled on the shape the mailbox actually uses it in: something that did
  // not exist in the seed, has to exist afterwards, and whose text nobody can
  // predict because the model writes it.
  const wrote = (text: string): Editor => ({
    ...seed,
    docs: [...seed.docs, { path: "draft.md", content: text, savedAt: "t1" }],
  });
  const golden = wrote(ANY);

  assert.equal(grade(EDITOR, seed, golden, wrote("anything at all")).status, "pass");
  assert.equal(grade(EDITOR, seed, golden, wrote("   ")).status, "incomplete", "whitespace is not content");
  assert.equal(grade(EDITOR, seed, golden, seed).status, "incomplete", "not writing it at all is not a pass");
});

test("ANY cannot express \"must change to something else\", and that is worth knowing", () => {
  /*
   * A limitation, named here rather than left to be discovered by a task that
   * quietly grades wrong.
   *
   * ANY matches any non-empty value — including the one already there. So on a
   * field that is already filled it records no required change at all, and an
   * agent that then changes it is marked as having done something nobody asked
   * for. It says "this must end up containing something", not "this must end up
   * different".
   *
   * Every current use is on an object absent from the seed, where `before` is
   * undefined and the distinction never arises. A task that needs "rewrite
   * this" needs a different marker, and this test is what will say so.
   */
  const golden: Editor = {
    ...seed,
    docs: seed.docs.map((d) => (d.path === "notes.md" ? { ...d, content: ANY } : d)),
  };

  assert.equal(
    grade(EDITOR, seed, golden, seed).status,
    "pass",
    "ANY over an already-filled field asks for nothing",
  );
  assert.equal(
    grade(EDITOR, seed, golden, edit(seed, "notes.md", "rewritten")).status,
    "overreach",
    "and rewriting it counts against the agent",
  );
});

/* ------------------------------------------------------------------ */
/* And the layering that makes it possible                             */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("the harness's grader contains no idea from the mail application", () => {
  const source = read("lib/harness/grade.ts");

  /*
   * Words from the domain under test, not merely words that also occur in it.
   * "subject" was on this list and is not a mail term here — `subjectOf` names
   * the object a path belongs to, which is exactly the vocabulary a generic
   * grader needs. A ban list that forces the API to be renamed is measuring the
   * wrong thing.
   */
  for (const word of ["email", "mailbox", "inbox", "folder", "starred", "MailState", "seedState"]) {
    assert.ok(
      !new RegExp(`\\b${word}\\b`, "i").test(source),
      `the grader mentions "${word}", so it is not environment-agnostic`,
    );
  }

  // And structurally: it imports nothing at all.
  assert.ok(
    !/^\s*import /m.test(source),
    "the grader imports something, so it depends on more than the state it is handed",
  );
});

test("the gym describes itself and nothing more", () => {
  // The size of the adapter is the claim: pointing the harness at another
  // application means writing another one of these, not editing the grader.
  const adapter = read("lib/environment/describe.ts");
  assert.ok(
    adapter.split("\n").length < 140,
    "the adapter has grown into a second grader",
  );
  assert.match(adapter, /Describable<MailState>/, "the adapter must implement the harness contract");

  /*
   * Checked as code, not prose. The first version of this searched the whole
   * file for "overreach" and failed on a comment explaining that verdicts are
   * the harness's job — the assertion reading the sentence that says it is
   * innocent.
   *
   * What matters is that the adapter takes only the contract and nothing that
   * would let it decide an outcome.
   */
  const fromHarness = [...adapter.matchAll(/^import (?:type )?\{([^}]*)\} from "[^"]*harness[^"]*";/gm)]
    .flatMap((m) => m[1]!.split(",").map((x) => x.trim()))
    .filter(Boolean);

  assert.deepEqual(
    fromHarness,
    ["Describable"],
    `the adapter takes ${fromHarness.join(", ")} from the harness; it may take only the contract`,
  );
});

test("the environment does not reach into the harness for anything but the contract", () => {
  /*
   * The gym is an application. It may implement an interface the harness
   * defines — that is what an adapter is — but nothing in the app itself may
   * depend on how grading works, or the two stop being separable.
   */
  for (const file of [
    "lib/environment/state.ts",
    "lib/environment/actions.ts",
    "lib/environment/catalog.ts",
    "lib/environment/serialize.ts",
    "lib/environment/computer.ts",
  ]) {
    assert.ok(
      !/from "[^"]*harness/.test(read(file)),
      `${file} imports from the harness, so the app is no longer standalone`,
    );
  }
});

test("the mailbox adapter still describes the mailbox correctly", () => {
  // The generic machinery is only worth anything if the real adapter still
  // works through it. Covered in depth by grade.test.ts; asserted here so this
  // file fails too if the seam is wired up wrong.
  assert.equal(MAILBOX.id, "clickmail-mailbox");
  assert.equal(MAILBOX.incidentalSuffix, ".read");
  assert.equal(MAILBOX.subjectOf("email(a@b | Hi).labels.finance"), "email(a@b | Hi)");
});
