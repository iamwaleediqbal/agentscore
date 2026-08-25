import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * What gets committed into a public repository.
 *
 * `public/runs/` is pushed and served to every visitor, so it is worth checking
 * mechanically rather than by eye. Everything the gym contains is synthetic —
 * the seed mailbox uses `.example` addresses, which RFC 2606 reserves for
 * exactly this — but that is a property of the current fixtures, not a law.
 * Point the environment at real data one day and these are the tests that
 * notice before the push does.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

function published(): string | null {
  try {
    return readFileSync(path.join(ROOT, "public/runs/index.json"), "utf8");
  } catch {
    return null;
  }
}

test("no real email address reaches the published artifacts", () => {
  const raw = published();
  if (!raw) return; // Nothing recorded yet.

  const addresses = [...new Set(raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g) ?? [])];
  const real = addresses.filter((address) => !address.endsWith(".example"));

  assert.deepEqual(real, [], "every address in a published run must be a reserved .example one");
});

test("no credential shape reaches the published artifacts", () => {
  const raw = published();
  if (!raw) return;

  for (const pattern of [/sk-or-v1-[A-Za-z0-9]/, /OPENROUTER_API_KEY/, /OWNER_PASSCODE/]) {
    assert.ok(!pattern.test(raw), `${pattern} must never appear in a committed run`);
  }
});

test("no local filesystem path reaches the published artifacts", () => {
  const raw = published();
  if (!raw) return;

  // Screenshot references are site-relative URLs, not paths on whoever recorded
  // them. An absolute path would leak a username and a directory layout.
  for (const pattern of [/\/Users\//, /\/home\/[a-z]/, /C:\\\\/]) {
    assert.ok(!pattern.test(raw), `${pattern} must not appear in a committed run`);
  }
});

test("the seed mailbox uses only reserved example domains", () => {
  // The fixture itself, not just what a run happened to record.
  const tasks = readFileSync(path.join(ROOT, "lib/harness/tasks.ts"), "utf8");
  const addresses = [...new Set(tasks.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g) ?? [])];

  assert.ok(addresses.length > 0, "the fixture should contain addresses to check");
  for (const address of addresses) {
    assert.ok(
      address.endsWith(".example"),
      `${address} is not a reserved documentation domain (RFC 2606)`,
    );
  }
});
