import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ACTION_NAMES, applyAction } from "../lib/environment/actions.ts";
import { CATALOG, actionReference, type ActionName } from "../lib/environment/catalog.ts";
import { SYSTEM_PROMPT } from "../lib/environment/serialize.ts";
import { seedState } from "../lib/environment/state.ts";

/**
 * Three layers that have drifted apart repeatedly: what the reducer will do,
 * what the interface offers, and what the browser driver actually clicks.
 *
 * This file existed before, went missing during the split, and its absence was
 * invisible — both mutation tools ran `node --test tests/reachable.test.ts`,
 * node exited non-zero because the file was not there, and a non-zero exit is
 * exactly what those tools read as "the mutation was caught". Six guards
 * reported themselves green for as long as the file was gone, and two of them
 * were guarding nothing at all. Those two are the first tests below.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * The driver's action switch, split at the case labels.
 *
 * Deliberately not a fixed-width window around each control: the first version
 * of this check used one, it ran past the end of a case, and it found an
 * `open-${id}` belonging to the *next* action — so the assertion passed for an
 * action that never opened anything.
 */
function driverCases(): string[] {
  const source = read("runner/driver.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return source.split(/\n\s*case\s+"/).slice(1);
}

test("a reading-pane control is only clicked on a message that is open", () => {
  // The constraint a person works under. A driver that clicks `reader-archive`
  // without opening the message is doing something no one using the interface
  // could do, and every verdict downstream of it is measuring the driver.
  const offenders = driverCases()
    .filter((body) => /"reader-[a-z-]+"/.test(body))
    .filter((body) => !body.includes("`open-${id}`"));

  assert.deepEqual(
    offenders.map((b) => b.slice(0, b.indexOf('"'))),
    [],
    "a reading-pane control is reached without opening the message first",
  );
});

test("an action the interface does not offer says so in the prompt", () => {
  // The whole point of the no-forward-control task is that the model has to
  // discover a capability is absent. If the prompt stops marking it, the task
  // stops measuring discovery and starts measuring luck.
  const reference = actionReference();
  const names = Object.keys(CATALOG) as ActionName[];

  const unavailable = names.filter((n) => CATALOG[n].reach === "none");
  assert.ok(unavailable.length > 0, "no action is marked unreachable, so this proves nothing");

  for (const name of unavailable) {
    const line = reference.split("\n").find((l) => l.trim().startsWith(name));
    assert.ok(line, `${name} is missing from the action reference`);
    assert.match(line, /NOT AVAILABLE/, `${name} is unreachable but the prompt does not say so`);
  }

  for (const name of names.filter((n) => CATALOG[n].reach !== "none")) {
    const line = reference.split("\n").find((l) => l.trim().startsWith(name));
    assert.ok(line, `${name} is missing from the action reference`);
    assert.ok(
      !line.includes("NOT AVAILABLE"),
      `${name} is reachable but the prompt tells the model it is not`,
    );
  }
});

test("every action the reducer accepts is one the model has been told about", () => {
  const reference = actionReference();
  for (const name of Object.keys(CATALOG) as ActionName[]) {
    assert.ok(
      reference.split("\n").some((l) => l.trim().startsWith(`${name} `)),
      `${name} exists but never appears in the action reference`,
    );
  }
});

test("the prompt's action list is generated, not transcribed", () => {
  // A hand-written list is correct until the catalogue changes, and then it is
  // a confident description of an interface that no longer exists.
  assert.ok(
    SYSTEM_PROMPT.includes(actionReference()),
    "the system prompt no longer carries the generated action reference",
  );
});

test("the reducer and the catalogue name exactly the same actions", () => {
  // Three lists that must agree: what the reducer will accept, what the
  // catalogue documents, and what the prompt shows. Comparing the catalogue to
  // itself proves nothing — rename a key and every derived list renames with
  // it — so the reducer's own switch labels are read out of its source.
  const reducer = new Set(
    [...read("lib/environment/actions.ts").matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]),
  );
  const catalogue = new Set(Object.keys(CATALOG));

  const undocumented = [...reducer].filter((n) => !catalogue.has(n)).sort();
  const unimplemented = [...catalogue].filter((n) => !reducer.has(n)).sort();

  assert.deepEqual(undocumented, [], "the reducer accepts actions the model is never told about");
  assert.deepEqual(unimplemented, [], "the catalogue documents actions the reducer will not take");
});

test("an action with no control behind it is refused, not performed", () => {
  // `reach: "none"` is a claim about the interface. If the reducer performs the
  // action anyway, the claim is false in the only place it matters: an agent
  // that ignores the prompt and tries it gets a world where it worked, and the
  // task that exists to measure discovering an absent capability measures
  // nothing at all.
  const unreachable = (Object.keys(CATALOG) as ActionName[]).filter(
    (n) => CATALOG[n].reach === "none",
  );
  assert.ok(unreachable.length > 0, "no action is marked unreachable, so this proves nothing");

  const seed = seedState();
  const target = seed.emails.find((e) => e.folder === "inbox");
  assert.ok(target, "the seed has no inbox message to aim at");

  for (const name of unreachable) {
    const result = applyAction(seed, {
      name,
      args: { id: target.id, to: "someone@example.com" },
    });
    assert.equal(
      result.ok,
      false,
      `${name} is documented as having no control, but the reducer performed it`,
    );
  }
});

test("every action the model is offered is one the driver knows how to perform", () => {
  // A fourth list, and the one nothing was comparing. `save_draft` was added to
  // the reducer and the catalogue — so the model was told about it — while the
  // Chromium driver had no case for it, which means tool mode would have
  // offered an action and then refused it as unknown. Same class as the others
  // here: three layers that must agree, checked against each other rather than
  // against themselves.
  const perform = new Set(
    [...read("runner/driver.ts").matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]),
  );

  const missing = (Object.keys(CATALOG) as ActionName[])
    .filter((name) => !perform.has(name))
    .sort();

  assert.deepEqual(missing, [], "the model is offered actions the browser driver cannot carry out");
});

test("the reducer's exported action list is the catalogue's", () => {
  // ACTION_NAMES is what the parser will accept from a model. A catalogue entry
  // missing from it is an action the prompt offers and the parser rejects.
  const named = new Set<string>(ACTION_NAMES);
  const missing = Object.keys(CATALOG).filter((name) => !named.has(name)).sort();
  const extra = [...named].filter((name) => !(name in CATALOG)).sort();

  assert.deepEqual(missing, [], "the prompt offers actions the parser will not accept");
  assert.deepEqual(extra, [], "the parser accepts actions the model is never told about");
});
