import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * A README that counts its own tests has to be right about it.
 *
 * "28 tests" was written once and then drifted three times, which is what
 * happens to every number typed into prose next to a number the machine keeps.
 * A reader has no way to tell a stale figure from a false one, and on a public
 * repository the two are indistinguishable from carelessness.
 *
 * Counting `test(` at the start of a line rather than shelling out: the suite
 * cannot run itself from inside itself, and every test in this project is
 * declared at the top level of its file, which is a convention worth having
 * something depend on.
 */
function declared(): number {
  const dir = path.join(ROOT, "tests");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => readFileSync(path.join(dir, file), "utf8"))
    .reduce((sum, source) => sum + (source.match(/^test\(/gm)?.length ?? 0), 0);
}

test("every test file sits where the test command will find it", () => {
  // `npm test` globs `tests/*.test.ts`. A file one directory down, or named
  // `.spec.ts`, is a test suite nobody runs — which looks exactly like a test
  // suite that passes.
  const stray = readdirSync(path.join(ROOT, "tests"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() || (entry.isFile() && !entry.name.endsWith(".test.ts")),
  );
  assert.deepEqual(stray.map((e) => e.name), [], "tests/ holds only *.test.ts files");
});

test("the README's test count is the number of tests there actually are", () => {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const claims = [...readme.matchAll(/#\s*(\d+)\s+tests/g)].map((m) => Number(m[1]));

  assert.ok(claims.length > 0, "the README should say how many tests there are");
  for (const claim of claims) {
    assert.equal(
      claim,
      declared(),
      `README says ${claim} tests; there are ${declared()}. Update the README.`,
    );
  }
});
