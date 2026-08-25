import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Guards on what reaches production.
 *
 * The deployment target is Vercel's free tier, where a serverless function is
 * smaller than a Chromium binary and there would be nothing to launch it with
 * anyway. Playwright is therefore confined to `runner/`, which has its own
 * manifest so the root install never sees it.
 *
 * That arrangement is invisible from inside any one file, which is exactly why
 * it needs a test. One `import { chromium } from "playwright"` in a component
 * would break the build in a way no type error catches, and the failure would
 * arrive as a deploy log rather than a red test.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_DIRS = ["app", "components", "lib", "hooks"];

function sourceFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path.join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const FILES = APP_DIRS.flatMap(sourceFiles);

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("the app source is large enough that a passing scan means something", () => {
  // A guard that scans nothing passes forever. This asserts the scan has input.
  assert.ok(FILES.length > 20, `expected to scan the app, found ${FILES.length} files`);
});

test("nothing the app ships imports playwright", () => {
  const offenders = FILES.filter((file) => {
    const source = readFileSync(file, "utf8");
    return (
      /\bfrom\s+["']playwright/.test(source) ||
      /\brequire\(\s*["']playwright/.test(source) ||
      /\bimport\(\s*["']playwright/.test(source)
    );
  });

  assert.deepEqual(
    offenders.map((f) => path.relative(ROOT, f)),
    [],
    "Playwright must stay in runner/ — it cannot run on the deployment target",
  );
});

test("nothing the app ships reaches into runner/", () => {
  const offenders = FILES.filter((file) => {
    const source = readFileSync(file, "utf8");
    return /\bfrom\s+["'][^"']*\/runner\//.test(source) || /\bfrom\s+["']@\/runner\//.test(source);
  });

  assert.deepEqual(
    offenders.map((f) => path.relative(ROOT, f)),
    [],
    "runner/ is excluded from the build; importing from it would break deployment",
  );
});

test("the root manifest declares no browser automation", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

  for (const name of declared) {
    assert.ok(
      !/^(playwright|puppeteer|@playwright\/)/.test(name),
      `${name} is in the root manifest; Vercel's install would fetch a browser for a build that cannot run one`,
    );
  }
});

test("the runner keeps its own manifest, so the root install never sees it", () => {
  const runner = JSON.parse(readFileSync(path.join(ROOT, "runner/package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };

  assert.ok(runner.dependencies?.playwright, "the runner is where playwright belongs");
});

test("the build script does not install or invoke the runner", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const build = manifest.scripts?.build ?? "";

  assert.ok(!/runner/.test(build), `the build script must not touch the runner: "${build}"`);
  assert.ok(!/playwright/.test(build), `the build script must not touch playwright: "${build}"`);
});

test("published run artifacts stay small enough to deploy", () => {
  // These are committed on purpose so the console can show real runs without a
  // server, which also means they are uploaded on every deploy.
  const shots = path.join(ROOT, "public/runs");
  let bytes = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else bytes += statSync(full).size;
    }
  };
  try {
    walk(shots);
  } catch {
    return; // Nothing recorded yet.
  }

  const megabytes = bytes / 1024 / 1024;
  assert.ok(
    megabytes < 40,
    `public/runs is ${megabytes.toFixed(1)}MB — prune older recordings before deploying`,
  );
});

/* -------------------------------------------------------------------- */
/* The observation the model is given                                    */
/* -------------------------------------------------------------------- */

test("tool mode does not scrape presentational class names", () => {
  // The bug this guards: observe() read .mrow-from / .mrow-subject / .reader.
  // The component was rebuilt on a different styling approach, those classes
  // disappeared, and the scrape kept succeeding — returning "" for every
  // sender, subject and preview. The model was handed four blank rows and
  // every run recorded that way measured the harness, not the model.
  const source = readFileSync(path.join(ROOT, "runner/driver.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const selector of [".mrow-", ".reader"]) {
    assert.ok(
      !code.includes(selector),
      `${selector} is a presentational hook and will vanish the next time the UI changes`,
    );
  }
});

test("the observation is built once, so nothing can show the model a different one", () => {
  /*
   * There used to be two drivers and two chances to describe the mailbox
   * differently. There is one now, and it calls the same `serialize` the tests
   * do — so an observation that is wrong is wrong everywhere, which is the only
   * way it gets noticed.
   */
  const driver = readFileSync(path.join(ROOT, "runner/driver.ts"), "utf8");

  assert.match(driver, /serialize\(state\)/, "the driver must serialise, not scrape");
  // observe() must read the world through the contract and serialise it, not
  // scrape the rendered page — which it did once, silently returning blank rows
  // after the component was restyled and the class names it looked for vanished.
  const observe = driver.slice(driver.indexOf("export async function observe"));
  assert.match(observe, /readState\(page\)/, "observe() must read state, not the DOM");
});

test("an empty mailbox stops the run instead of being scored", () => {
  // A verdict computed against a blank observation is a verdict about nothing.
  const source = readFileSync(path.join(ROOT, "runner/driver.ts"), "utf8");

  assert.match(source, /the environment reported an empty mailbox/);
  assert.match(source, /!state\.emails\.length/);
});

test("the README points at every mutation check that exists", () => {
  /*
   * A mutation tool nobody is told to run is a tool nobody runs. These are the
   * only thing standing between "the suite is green" and "the suite would go
   * red if the bug came back", and they are not wired into `npm test` on
   * purpose — each one edits source files and restores them, which is not
   * something to do concurrently with a watch process.
   */
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const tools = readdirSync(path.join(ROOT, "tools"))
    .filter((name) => name.endsWith("-check.py"));

  assert.ok(tools.length >= 3, `only found ${tools.length} mutation tools`);
  for (const tool of tools) {
    assert.ok(
      readme.includes(tool),
      `tools/${tool} exists and the README never tells anyone to run it`,
    );
  }
});

test("the deployment verifier probes every route that used to exist", () => {
  /*
   * The apps are static and have no API. That is a claim about what is
   * deployed, which no test in this repository can see — so it is checked from
   * outside, and this checks the checker.
   *
   * The routes below are the ones that did exist. Any of them answering means
   * something is deployed that this repository no longer contains, which is
   * exactly the case a green build would not notice.
   */
  const script = readFileSync(path.join(ROOT, "verify-deployment.sh"), "utf8");

  for (const route of ["/api/agent", "/api/session", "/api/models"]) {
    assert.ok(script.includes(route), `the verifier never tries ${route}`);
  }
  assert.match(script, /-X POST/, "it must try them as a run request would");
});

test("the verifier treats any success from those routes as a failure", () => {
  // Anchored to every 2xx branch, not to one of them: a route that answered is
  // a failure wherever it was observed.
  const script = readFileSync(path.join(ROOT, "verify-deployment.sh"), "utf8");
  const branches = script.split("\n").filter((line) => /^\s*2\*\)/.test(line));

  assert.ok(branches.length >= 1, "no 2xx branch at all — a success would go unnoticed");
  for (const branch of branches) {
    assert.match(branch, /\bbad\b/, `a 2xx answer is not treated as a failure: ${branch.trim()}`);
  }
  assert.match(script, /exit 1/, "and the script must exit non-zero");
});

/**
 * Every route this app serves, by directory.
 *
 * Read off the filesystem rather than listed here, because a list would agree
 * with itself and the whole point is to catch a route that exists in the repo
 * and not on the deployment.
 */
function routeDirs(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const next = path.join(dir, entry.name);
      const relNext = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(relNext);
      walk(next, relNext);
    }
  };
  walk(path.join(ROOT, "app"), "");
  return out;
}

test("no ignore pattern can swallow a route", () => {
  /*
   * The failure this exists for, and it reached production.
   *
   * `.vercelignore` follows .gitignore matching: a pattern with no slash in it
   * matches a directory of that name at ANY depth. `tools/` was written to keep
   * the mutation scripts out of the build, and it did — and it also matched
   * `app/tools/`, the route that shows both system prompts verbatim. That page
   * was never uploaded. The nav linked to it, the link 404'd, and every check in
   * this repository passed, because the pattern was perfectly correct about the
   * directory it was named for.
   *
   * Anchoring with a leading slash confines a pattern to the project root.
   */
  const ignore = read(".vercelignore")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const routes = routeDirs();

  for (const pattern of ignore) {
    if (pattern.startsWith("/")) continue; // anchored to the root; cannot reach app/

    const name = pattern.replace(/\/$/, "");
    const swallowed = routes.filter(
      (route) => route === name || route.split("/").includes(name),
    );

    assert.deepEqual(
      swallowed,
      [],
      `the unanchored pattern "${pattern}" also excludes app/${swallowed[0]} — anchor it as "/${pattern}"`,
    );
  }
});

test("every pattern in .vercelignore is anchored", () => {
  // Stronger than the test above and the reason it can stay simple: an
  // unanchored pattern is a trap even when nothing collides with it today,
  // because the collision arrives later as a new route and nothing local fails.
  const unanchored = read(".vercelignore")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => !line.startsWith("/"));

  assert.deepEqual(unanchored, [], "these match at any depth, including inside app/");
});

test("the page that shows the system prompts is a route that ships", () => {
  // Named specifically, because it is the one that was lost and because a
  // benchmark that will not show what it told the model is not reproducible.
  assert.ok(
    routeDirs().includes("tools"),
    "app/tools is gone — the system prompts are no longer shown anywhere",
  );
});
