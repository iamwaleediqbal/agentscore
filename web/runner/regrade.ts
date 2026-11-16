/**
 * npm run regrade
 *
 * Scores every published run again from the snapshots stored on it, using the
 * grader as it is in this checkout. Nothing is called: no model, no browser, no
 * environment. Use it after changing the grading logic to see which verdicts
 * the change moves, before deciding to publish them.
 *
 *   npm run regrade              report only, the file is not touched
 *   npm run regrade -- --check   same, but exit 1 if any verdict would change (for CI)
 *   npm run regrade -- --write   save the new verdicts into the index
 *   npm run regrade -- --file <path>   a different index file
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { regrade } from "../lib/harness/regrade.ts";
import type { RunRecord } from "../lib/harness/runs.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const flag = (name: string) => process.argv.includes(`--${name}`);

const file = path.resolve(arg("file") ?? path.join(import.meta.dirname, "../public/runs/index.json"));
const index = JSON.parse(await readFile(file, "utf8")) as { runs: RunRecord[] } & Record<string, unknown>;

const report = regrade(index.runs);

console.log(`${index.runs.length} run(s) in ${path.relative(process.cwd(), file)}`);
console.log(`  regraded:  ${report.checked}`);
console.log(`  unchanged: ${report.unchanged}`);
console.log(`  changed:   ${report.changed.length}`);
console.log(`  skipped:   ${report.skipped.length}`);

for (const moved of report.changed) {
  console.log(`  ${moved.id}  ${moved.before ?? "none"} -> ${moved.after ?? "none"}  (${moved.model})`);
}
for (const skip of report.skipped) {
  console.log(`  skipped ${skip.id}: ${skip.reason}`);
}

if (flag("write") && report.changed.length) {
  // Same shape and formatting the runner writes, so the diff shows only verdicts.
  await writeFile(file, JSON.stringify({ ...index, runs: report.runs }, null, 2));
  console.log(`\nSaved ${report.changed.length} new verdict(s) to ${path.relative(process.cwd(), file)}`);
} else if (report.changed.length) {
  console.log("\nNothing written. Run with --write to save the new verdicts.");
}

if (flag("check") && report.changed.length) process.exit(1);
