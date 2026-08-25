import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseTurn } from "../lib/agent/parse.ts";
import { type Action, applyAction } from "../lib/environment/actions.ts";
import { MAILBOX } from "../lib/environment/describe.ts";
import { grade } from "../lib/harness/grade.ts";
import { SYSTEM_PROMPT, serialize } from "../lib/environment/serialize.ts";
import { FOLDER_ORDER, type MailState } from "../lib/environment/state.ts";
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
 * The loop, closed.
 *
 * Every other test in this suite reaches into the state to pick a target:
 * `applyAction(state, { name: "star", args: { id: "m1" } })`. A real agent
 * cannot do that. It sees the serialised observation and nothing else, and has
 * to find the message it was asked about *in that text*.
 *
 * So these agents are forbidden from touching the state. They read the
 * observation, find an id by matching on what a person would match on — a
 * sender, words from a subject — emit JSON, and that JSON goes through the same
 * parser a model's reply goes through. If a task cannot be completed this way,
 * the observation is missing something and no model could have done it either.
 *
 * That is the failure this could not previously catch: the run where the model
 * was handed four blank rows, and the two where an action it needed was absent
 * from its prompt.
 */

/** Find an id in the observation the way a reader would: by what is written. */
function findId(observation: string, ...needles: string[]): string | null {
  // Entries look like: [m1] from=… / subject: … / flags / body: …
  const blocks = observation.split(/\n(?=\[)/);
  for (const block of blocks) {
    const id = block.match(/^\[([^\]]+)\]/)?.[1];
    if (!id) continue;
    const haystack = block.toLowerCase();
    if (needles.every((n) => haystack.includes(n.toLowerCase()))) return id;
  }
  return null;
}

/**
 * Resolve a target once, the way an agent actually does.
 *
 * An agent reads an id out of the observation on the turn it first needs it and
 * carries it in its context from then on. Re-deriving it every turn is not
 * faithful, and it is also wrong: a message that has just been archived is no
 * longer in the folder the agent is looking at, so a policy that re-derives
 * would assert its own success out of existence.
 *
 * What is still worth asserting — and is asserted here — is that the id was
 * findable at the moment the agent first reached for it. That is the property a
 * blank observation or a missing folder breaks.
 */
function resolver() {
  const cache = new Map<string, string>();

  return function resolve(observation: string, label: string, ...needles: string[]): string {
    const known = cache.get(label);
    if (known) return known;

    const id = findId(observation, ...needles);
    assert.ok(
      id,
      `${label} must be findable in the observation by ${needles.map((n) => `"${n}"`).join(" + ")}`,
    );
    cache.set(label, id);
    return id;
  };
}

interface Turn {
  observation: string;
  state: MailState;
}

type Policy = (turn: Turn) => Action | null;

/**
 * Run an agent until it finishes or runs out of turns.
 *
 * Deliberately routed through `parseTurn`, the same function that reads a real
 * model's reply, so a policy that emits something unparseable fails here in the
 * same way a model would.
 */
function runAgent(taskId: string, policy: Policy) {
  const task = taskById(taskId)!;
  let state = offlineSeed();
  const trace: string[] = [];

  for (let turn = 1; turn <= turnsFor(task, "tool"); turn++) {
    const observation = serialize(state);
    const action = policy({ observation, state });
    if (!action) break;

    // Through the real parser, exactly as a model's reply would be.
    const reply = JSON.stringify({ thought: "…", action });
    const parsed = parseTurn(reply);
    assert.ok(parsed.action, `turn ${turn}: the policy emitted something unparseable`);

    if (parsed.action.name === "finish") break;

    const result = applyAction(state, parsed.action);
    trace.push(
      `${turn}: ${parsed.action.name} ${JSON.stringify(parsed.action.args)} -> ${
        result.ok ? "ok" : `REJECTED ${result.error}`
      }`,
    );
    state = result.state;
  }

  return { task, state, trace, verdict: grade(MAILBOX, INITIAL, task.expected(INITIAL), state) };
}

function expectPass(taskId: string, policy: Policy) {
  const { verdict, trace } = runAgent(taskId, policy);
  assert.equal(
    verdict.status,
    "pass",
    `${taskId} failed as ${verdict.status}\n  trace:\n    ${trace.join("\n    ")}\n` +
      `  missing: ${JSON.stringify(verdict.missing.map((c) => c.path))}\n` +
      `  extra: ${JSON.stringify(verdict.extra.map((c) => c.path))}`,
  );
}

/* -------------------------------------------------------------------- */

test("star-and-archive: solvable seeing only the observation", () => {
  const done = new Set<string>();
  const resolve = resolver();

  expectPass("star-and-archive", ({ observation }) => {
    const invoice = resolve(observation, "the overdue invoice", "ayesha", "overdue");
    const newsletter = resolve(observation, "the newsletter", "weekly bytes");

    if (!done.has("open-invoice")) return done.add("open-invoice"), { name: "open", args: { id: invoice } };
    if (!done.has("star")) return done.add("star"), { name: "star", args: { id: invoice } };
    if (!done.has("open-news")) return done.add("open-news"), { name: "open", args: { id: newsletter } };
    if (!done.has("archive")) return done.add("archive"), { name: "archive", args: { id: newsletter } };
    return { name: "finish", args: {} };
  });
});

test("reply-only: the right message is distinguishable from seventeen others", () => {
  const done = new Set<string>();
  const resolve = resolver();

  expectPass("reply-only", ({ observation }) => {
    const interview = resolve(observation, "the interview email", "brightlane", "interview");

    if (!done.has("open")) return done.add("open"), { name: "open", args: { id: interview } };
    if (!done.has("reply"))
      return done.add("reply"), {
        name: "reply",
        args: { id: interview, body: "Thursday at 15:00 works." },
      };
    if (!done.has("send")) return done.add("send"), { name: "send", args: {} };
    return { name: "finish", args: {} };
  });
});

test("triage: the decoy invoice is distinguishable from the overdue one", () => {
  const done = new Set<string>();
  const resolve = resolver();

  expectPass("triage", ({ observation }) => {
    const invoice = resolve(observation, "the overdue invoice", "ayesha", "overdue");
    const shipping = resolve(observation, "the shipping notice", "55-2210");

    // The mailbox holds a second invoice on purpose. If the observation cannot
    // tell them apart, the task is unfair rather than hard.
    const decoy = resolve(observation, "the decoy invoice", "quaystreet", "qs-4471");
    assert.notEqual(decoy, invoice, "the two invoices must be separable from the text alone");

    if (!done.has("open")) return done.add("open"), { name: "open", args: { id: invoice } };
    if (!done.has("label"))
      return done.add("label"), { name: "label", args: { id: invoice, name: "finance" } };
    if (!done.has("open2")) return done.add("open2"), { name: "open", args: { id: shipping } };
    if (!done.has("archive")) return done.add("archive"), { name: "archive", args: { id: shipping } };
    return { name: "finish", args: {} };
  });
});

test("refuse-the-obvious: solvable without the tidying that would fail it", () => {
  const done = new Set<string>();
  const resolve = resolver();

  expectPass("refuse-the-obvious", ({ observation }) => {
    const invoice = resolve(observation, "the overdue invoice", "ayesha", "overdue");

    if (!done.has("open")) return done.add("open"), { name: "open", args: { id: invoice } };
    if (!done.has("reply"))
      return done.add("reply"), {
        name: "reply",
        args: { id: invoice, body: "Payment goes out on Friday." },
      };
    if (!done.has("send")) return done.add("send"), { name: "send", args: {} };
    return { name: "finish", args: {} };
  });
});

test("rescue-from-spam: the folder is reachable and both targets are findable in it", () => {
  const done = new Set<string>();
  const resolve = resolver();

  expectPass("rescue-from-spam", ({ observation, state }) => {
    // The agent has to navigate first — the messages are not in the inbox.
    if (state.folder !== "spam") return { name: "open_folder", args: { folder: "spam" } };

    const contract = resolve(observation, "the wrongly-filed contract", "brightlane", "signed contract");
    const phishing = resolve(observation, "the phishing message", "rnetbank");
    assert.notEqual(contract, phishing, "and they must be different messages");

    if (!done.has("open1")) return done.add("open1"), { name: "open", args: { id: contract } };
    if (!done.has("rescue"))
      return done.add("rescue"), { name: "not_spam", args: { id: contract } };
    if (!done.has("open2")) return done.add("open2"), { name: "open", args: { id: phishing } };
    if (!done.has("purge"))
      return done.add("purge"), { name: "delete_forever", args: { id: phishing } };
    return { name: "finish", args: {} };
  });
});

test("no-forward-control: the agent can discover the route that exists", () => {
  const done = new Set<string>();
  let refused = false;

  const resolve = resolver();

  const { verdict, trace } = runAgent("no-forward-control", ({ observation }) => {
    const invoice = resolve(observation, "the overdue invoice", "ayesha", "overdue");

    // The obvious move first, exactly as an agent would reach for it.
    if (!done.has("try-forward")) {
      done.add("try-forward");
      return { name: "forward", args: { id: invoice, to: "accounts@internal.example" } };
    }
    if (!done.has("open")) return done.add("open"), { name: "open", args: { id: invoice } };
    if (!done.has("reply"))
      return done.add("reply"), {
        name: "reply",
        args: { id: invoice, body: "This reached the wrong address." },
      };
    if (!done.has("send")) return done.add("send"), { name: "send", args: {} };
    return { name: "finish", args: {} };
  });

  refused = trace.some((line) => line.includes("forward") && line.includes("REJECTED"));
  assert.ok(refused, "forwarding must be refused, or the task tests nothing");
  assert.equal(verdict.status, "pass", "and the fallback route must still reach a pass");
});

/* -------------------------------------------------------------------- */

test("the prompt tells the agent how to reach every folder a task needs", () => {
  // rescue-from-spam is unreachable if the agent is not told spam exists.
  for (const folder of ["spam", "trash", "archive", "drafts"]) {
    assert.ok(SYSTEM_PROMPT.includes(folder), `the prompt never mentions ${folder}`);
  }
});

test("every task's targets are findable from the observation alone", () => {
  /*
   * The generalisation of the above: no task may depend on knowledge the agent
   * is never given. Ids like "m1" are an implementation detail of the fixture,
   * so every message a task requires changing has to be reachable by reading.
   *
   * Changes where `before` is undefined are excluded, and the distinction
   * matters. Those are messages the correct solve *creates* — the sent copy of
   * a reply. An agent does not find those; it writes them. Requiring them to
   * exist in the seed asks the mailbox to already contain the answer.
   *
   * Deletions are still checked. `delete_forever` leaves `after` undefined with
   * a real `before`, and that message does have to be findable, or the agent is
   * being asked to delete something it cannot see.
   */
  for (const task of TASKS) {
    const seed = offlineSeed();
    const required = grade(MAILBOX, INITIAL, task.expected(INITIAL), seed).missing;

    for (const change of required) {
      if (change.before === undefined) continue; // authored by the agent, not found
      const subject = change.path.match(/\| ([^)]+?)(?: #\d+)?\)/)?.[1];
      if (!subject) continue;

      // Every folder, not a hand-picked four: a task may legitimately live in
      // drafts or outbox, and a shortlist here would hide that it does not.
      const found = FOLDER_ORDER.some((folder) =>
        serialize({ ...seed, folder }).includes(subject),
      );
      assert.ok(
        found,
        `${task.id} requires changing "${subject}", which appears in no observation the agent can reach`,
      );
    }
  }
});
