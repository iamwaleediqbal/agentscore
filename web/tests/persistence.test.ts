import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ACTION_NAMES } from "../lib/environment/actions.ts";
import { FOLDER_ORDER, STORAGE_KEY, hydrate, seedState, storageKeyFor } from "../lib/environment/state.ts";
import { TASKS } from "../lib/harness/tasks.ts";

/**
 * What survives leaving the process.
 *
 * Three things outlive a run: the mailbox in local storage, the run records in
 * local storage, and `public/runs/index.json`, which is committed and served to
 * every visitor. All three are read back by code that did not write them —
 * often a later version of it — and each has already broken once that way:
 * `query` was added to the state and a restored mailbox came back with it
 * `undefined`, which took the first render down rather than degrading.
 *
 * So the contract is tested from the reading side, with the kind of input the
 * reader will actually meet: an older save, a truncated file, a hand-edited
 * one, and nothing at all.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ */
/* The mailbox, restored                                               */
/* ------------------------------------------------------------------ */

test("a mailbox saved by this version comes back identical", () => {
  const state = seedState();
  const restored = hydrate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
});

test("a mailbox saved before a field existed comes back usable", () => {
  // The actual bug: `query` was added, a restored save had no `query`, and
  // `state.query.trim()` threw on the first render.
  const old = JSON.parse(JSON.stringify(seedState())) as Record<string, unknown>;
  delete old.query;
  delete old.folder;

  const restored = hydrate(old);
  assert.equal(typeof restored.query, "string");
  assert.ok(FOLDER_ORDER.includes(restored.folder));
});

test("nothing that can be in storage makes hydrate throw", () => {
  const junk: unknown[] = [
    undefined,
    null,
    0,
    "",
    "not json, but something parsed it anyway",
    [],
    {},
    { emails: null },
    { emails: [] }, // an empty array is a corrupt save, not an empty mailbox
    { emails: "nope" },
    { selectedId: 42 },
    { folder: "banana" },
    { folder: null },
    { query: 7 },
    { composer: "yes" },
  ];

  for (const raw of junk) {
    let restored;
    assert.doesNotThrow(() => {
      restored = hydrate(raw);
    }, `hydrate threw on ${JSON.stringify(raw)}`);

    assert.ok(Array.isArray(restored!.emails) && restored!.emails.length, "no mail came back");
    assert.equal(typeof restored!.query, "string");
    assert.ok(FOLDER_ORDER.includes(restored!.folder), `folder came back as ${restored!.folder}`);
    assert.ok(
      restored!.selectedId === null || typeof restored!.selectedId === "string",
      "selectedId came back as neither null nor a string",
    );
  }
});

test("the storage key carries a version, so a shape change can be retired", () => {
  assert.match(STORAGE_KEY, /\.v\d+$/, `"${STORAGE_KEY}" has no version suffix`);
  assert.equal(storageKeyFor(null), STORAGE_KEY);
  assert.notEqual(storageKeyFor("abc"), STORAGE_KEY);
  assert.ok(storageKeyFor("abc").startsWith(STORAGE_KEY), "a run key must stay under the same prefix");
});

/* ------------------------------------------------------------------ */
/* What is committed and served                                        */
/* ------------------------------------------------------------------ */

interface PublishedShape {
  generated_at?: unknown;
  driver?: unknown;
  runs?: unknown;
}

function publishedIndex(): PublishedShape | null {
  const file = path.join(ROOT, "public/runs/index.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as PublishedShape;
}

test("the committed index parses and has the field the console reads", () => {
  const index = publishedIndex();
  if (!index) return; // Nothing recorded yet; the console falls back to seeded samples.

  assert.ok(Array.isArray(index.runs), "runs must be an array, or loadPublished discards the file");
  assert.equal(typeof index.driver, "string", "the driver must be named");
});

test("every published run is one the console can render", () => {
  const index = publishedIndex();
  const runs = (index?.runs ?? []) as Array<Record<string, unknown>>;
  const known = new Set(TASKS.map((t) => t.id));
  const statuses = new Set([
    "completed", "max_turns", "no_action", "cancelled",
    "infrastructure_error", "config_error",
  ]);

  for (const run of runs) {
    assert.equal(typeof run.id, "string", "a run with no id cannot be keyed in a list");
    assert.ok(known.has(run.taskId as string), `run ${run.id} is for task "${run.taskId}", which no longer exists`);
    assert.ok(statuses.has(run.status as string), `run ${run.id} has status "${run.status}"`);
    assert.ok(Array.isArray(run.entries), `run ${run.id} has no timeline`);
    assert.equal(typeof run.cost, "number", `run ${run.id} has a non-numeric cost, which formats as NaN`);
    assert.ok(
      run.mode === undefined || run.mode === "tool" || run.mode === "computer",
      `run ${run.id} is in action space "${run.mode}"`,
    );

    for (const entry of run.entries as Array<Record<string, unknown>>) {
      assert.ok(
        ["model_thinking", "model_response", "action"].includes(entry.entry_type as string),
        `run ${run.id} has a timeline entry of type "${entry.entry_type}"`,
      );
      if (entry.entry_type === "action") {
        assert.ok(
          (ACTION_NAMES as readonly string[]).includes(entry.action_name as string) ||
            typeof entry.action_name === "string",
          `run ${run.id} records an action with no name`,
        );
        /*
         * Two shapes, both legitimate, and this only accepted one.
         *
         * The in-page harness inlined screenshots as data URLs. The Chromium
         * runner writes real JPEGs under `public/runs/shots/` and references
         * them by path — deliberately, because fifty base64 images in one JSON
         * file is a document no editor will open and a payload every visitor
         * downloads whether or not they look at a run. The first genuinely
         * recorded run failed here, and the runner was right.
         *
         * A path is checked harder than a data URL, though: it has to resolve
         * to a file that is actually on disk. A reference to a screenshot that
         * was pruned, or never written, renders as a broken image on a page
         * whose entire job is showing evidence.
         */
        if (entry.screenshot !== undefined) {
          const shot = String(entry.screenshot);
          if (shot.startsWith("data:")) {
            assert.match(
              shot,
              /^data:image\/(jpeg|png|webp);base64,/,
              `run ${run.id} has an inline screenshot that is not an image`,
            );
          } else {
            assert.match(
              shot,
              /^\/runs\/shots\/[^/]+\/[^/]+\.(jpg|jpeg|png|webp)$/,
              `run ${run.id} has a screenshot reference the console cannot serve: ${shot}`,
            );
            assert.ok(
              existsSync(path.join(ROOT, "public", shot)),
              `run ${run.id} points at ${shot}, which is not on disk — it renders as a broken image`,
            );
          }
        }
      }
    }
  }
});

test("no screenshots are deployed for a run nobody can open", () => {
  /*
   * An abandoned recording leaves its folder behind. Nothing links to it, so
   * nothing shows it is there — it is simply uploaded on every deploy and
   * counted against the artifact budget for as long as it stays committed.
   */
  const dir = path.join(ROOT, "public/runs/shots");
  if (!existsSync(dir)) return;

  const index = publishedIndex();
  const runs = (index?.runs ?? []) as Array<Record<string, unknown>>;
  const referenced = JSON.stringify(runs);

  const orphans = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !referenced.includes(name));

  assert.deepEqual(
    orphans,
    [],
    `public/runs/shots holds folders no published run refers to: ${orphans.join(", ")}`,
  );
});

test("the runner writes the index the console reads", () => {
  // Two files, one filename, no import between them.
  assert.ok(read("lib/harness/published.ts").includes("/runs/index.json"));
  assert.ok(
    /public\/runs/.test(read("runner/run.ts")),
    "the runner no longer writes into public/runs",
  );
});
