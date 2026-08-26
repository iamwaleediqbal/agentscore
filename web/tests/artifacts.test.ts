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

/**
 * Reserved domains, and nothing else, in anything this project authored.
 *
 * `.example` is reserved by RFC 2606 and can never belong to anyone. The
 * seeded mailbox, the tasks and the graders all use it, which is what makes a
 * published run safe to commit.
 */
const RESERVED = /\.example$|^example\.(com|net|org)$/;

/**
 * Domains a placeholder cannot be. If one of these appears, something has
 * copied a real address in from somewhere.
 */
const PERSONAL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|proton|protonmail|icloud|me|aol|gmx|yandex)\./;

/** Placeholders models invent unprompted. Not reserved, but not anyone's, either. */
const MODEL_PLACEHOLDERS = new Set(["test.com", "test.test", "email.com", "domain.com"]);

test("no real email address reaches the published artifacts", () => {
  const raw = published();
  if (!raw) return; // Nothing recorded yet.

  // The domain must not end on a dot or a hyphen. Without that, an address at
  // the end of a sentence — "…reply to hiring@brightlane.example." — matches
  // with the full stop attached, fails the reserved check, and reports a
  // reserved address as a leaked real one. A test that cries wolf about a
  // privacy leak is worse than no test: the next person to see it red assumes
  // it is the punctuation again.
  const addresses = [
    ...new Set(raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*/g) ?? []),
  ];
  const domains = addresses.map((address) => address.split("@")[1]!.toLowerCase());

  /*
   * Two rules, because a run record has two kinds of text in it.
   *
   * Everything this project wrote — the mailbox, the tasks, the graders — is
   * held to the reserved domains. But a model composing a reply writes whatever
   * it likes into the body, and it will invent `test@test.com` unprompted. That
   * is model output, not a leak, and failing on it teaches everyone to ignore
   * this test.
   *
   * So the strict rule keeps its edge where it matters, and the invented
   * placeholders are named rather than pattern-matched: a new one has to be
   * looked at and added deliberately, which is the review this test exists to
   * force.
   */
  const unaccounted = domains.filter(
    (domain) => !RESERVED.test(domain) && !MODEL_PLACEHOLDERS.has(domain),
  );
  assert.deepEqual(
    unaccounted,
    [],
    "an address appeared that is neither reserved nor a known model placeholder — look at it before allowing it",
  );

  // And nothing that could be a person's, whoever wrote it. This is the one
  // that must never be relaxed.
  const personal = domains.filter((domain) => PERSONAL.test(domain));
  assert.deepEqual(personal, [], "a personal mail domain reached a committed run");
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
