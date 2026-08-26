# agentscore

The harness. It drives an application, grades what the agent left behind, and
repeats it enough times for the number to mean something.

![CI](https://github.com/iamwaleediqbal/agentscore/actions/workflows/ci.yml/badge.svg)

**Live:** [agentscore-sigma.vercel.app](https://agentscore-sigma.vercel.app) — the console, reading committed runs.
The environment it drives is [clickmail-sigma.vercel.app/gym](https://clickmail-sigma.vercel.app/gym).

Two measurements live here, and they are not interchangeable:

**Browser agents.** `web/` opens [clickmail](https://github.com/iamwaleediqbal/clickmail)
in a real browser, fetches the world before the task and after it, and grades one
snapshot against the other — never the route taken, because there are many
correct routes. Both snapshots are kept on the run record, so a change to the
grading logic is retested against every past run without a single model call.

**Instruction following.** The Python suite repeats short tasks across free
models and reports pass rates as intervals, with overlapping intervals left as
ties.

## Layout

```
src/agentscore/   the Python suite: graders, Wilson intervals, ranking
suites/           task suites for it
web/              the console (Next.js, static) and the Playwright runner
web/runner/       what actually drives a browser
```

The console is static and holds **no key**. It reads committed run records and
nothing else, so every visitor sees the same evidence and the only way that
changes is somebody recording a run and pushing it. Recording needs a key and
happens on a laptop.

It shows both system prompts exactly as sent — generated from the same constants
the runner uses, because a benchmark that paraphrases what it told the model is
not reproducible by anyone reading it.

## Four opinions, and what each one prevents

### 1. One run is not a result

Every task is attempted `repeats` times and reported as a pass rate with a
**Wilson 95% interval**. Not the textbook normal approximation, which most
dashboards use and which reports a width of exactly zero for 0/5 and 5/5,
precisely where an eval needs an interval most.

```python
wilson(3, 3)   # point 1.00, low 0.44, high 1.00
```

Three out of three is 100%, with a lower bound near 44%. That is the correct
amount of confidence to have in three attempts.

### 2. Overlapping intervals are a tie, not a ranking

If two models' intervals overlap, the report gives them the same rank and marks
it. Ranking them anyway invents a difference the data cannot support, and that
is how a leaderboard ends up reordering itself nightly for no reason anyone can
explain.

Ranks are counted against every other model, not against the one immediately
above. Comparing to the neighbour makes overlap transitive, so a chain of
models that each overlap the next collapses into one giant tie even when the
top and bottom are plainly different. There is a test named
`test_overlap_is_not_transitive` because I got this wrong the first time.

### 3. A broken request is not a bad score

Attempts that never reached a model are **dropped, not scored zero**. Free
endpoints throttle, and counting a 429 as a failure means the model with the
unluckiest network looks like the worst model. Dropped counts are printed in
their own column, so a model whose results are thin cannot hide it.

### 4. The judge is a last resort, not a default

Deterministic checks run first: exact, contains, regex, numeric, JSON shape. If
one fails, the judge is never called, because nothing a judge could say changes
a failed deterministic check.

Only tasks where correctness is genuinely a reading problem carry a `judge`
check. Two reasons that matters. A judge call spends a request from the same
daily quota the run itself is spending. And a judge is a model, so it brings
its own variance and sits on top of the variance you were trying to measure.

When a judge returns something unparseable, the check **fails closed**.
Defaulting to pass would mean every judge outage silently inflates every score
in the run, and it would look like the models got better that night.

---

## Writing tasks

Tasks are data, not code. A suite can be reviewed by someone who does not write
Python, diffed in a pull request, and versioned without anyone worrying that a
YAML file might execute something.

```yaml
name: instruction-following
models:
  - thinkingmachines/inkling:free
  - dots-studio/dots-3-note-preview:free
judge_model: thinkingmachines/inkling:free
repeats: 5

tasks:
  - id: extraction
    prompt: |
      From this line, return only the invoice number:
      "Payment of PKR 45,000 received against INV-2026-0871 on 3 March."
    checks:
      - kind: contains
        value: INV-2026-0871
      - kind: not_contains
        value: "45,000"

  - id: trap-question
    prompt: What year did Ferdinand Magellan first set foot on the moon?
    checks:
      - kind: judge
        rubric: |
          Passes only if the answer states the premise is false. Fails if it
          supplies any year, or plays along with the premise in any way.
```

Check kinds: `exact`, `contains`, `contains_all`, `not_contains`, `regex`,
`numeric` (with tolerance), `json_valid` (with required keys), `judge`.

Two grading decisions worth knowing about, because both cut the other way from
what a naive implementation does:

**`numeric` reads the last number, not the first.** Models restate the question
before answering it. Taking the first number grades the question rather than
the answer, and produces a score that correlates with verbosity instead of
skill.

**`json_valid` strips markdown fences.** Models fence JSON however firmly you
ask them not to. Failing on the fence measures formatting compliance when the
task was about content. If format is what you care about, that is a separate
`regex` check and it should say so out loud.

---

## Setup

Two halves, installed independently. Neither needs the other, and neither needs
a key until you actually record something.

### The web half — `web/`

Node 22 or newer.

```bash
cd web
npm install
npm run dev          # http://localhost:3000
npm test             # 331 tests, and they run with no install at all
```

The suite has no dependencies — Node's own test runner and type stripping — so
`npm test` is green before `npm install` finishes. Only `npm run typecheck` and
`npm run lint` need it. Recording real runs is [`web/README.md`](web/README.md),
which is also where the grader, the two action spaces, the turn budgets and the
cost guards are documented in full.

### The Python half — this directory

Python 3.10 or newer, and a free OpenRouter key from
[openrouter.ai/keys](https://openrouter.ai/keys).

**1. Install.**

```bash
git clone https://github.com/iamwaleediqbal/agentscore.git
cd agentscore
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
```

The install pulls [polyact](https://github.com/iamwaleediqbal/polyact) straight
from GitHub, which is why `git` has to be on your path. Once polyact is on
PyPI, `pyproject.toml` can name a version instead of a git URL, and the
dependency resolves normally.

**Working on both at once?** That git URL installs a *snapshot* of polyact's
main branch, so a change you make in a local polyact checkout is invisible here
until you reinstall — and the symptom is not subtle: the moment this repository
imports something the snapshot predates, every test fails at collection on one
ImportError. Point the environment at the checkout instead:

```bash
pip install -e ../polyact
```

CI still resolves the git URL, which is the stricter check and the right way
round: local runs against what you are editing, CI against what is published.

**2. Point it at a key.**

```bash
cp .env.example .env
# put your key in .env, then:
export $(grep -v '^#' .env | xargs)
```

**3. Run a small suite first.**

```bash
agentscore suites/instruction-following.yaml --out results/ --repeats 2 --models thinkingmachines/inkling:free
```

One model at two repeats is 20 requests: 16 attempts, plus 4 judge calls for
the two tasks that need one. That fits inside the free tier's 50 a day while
you are still deciding about the $10 below. Drop both flags for the full run,
which is 200 attempts and needs the raised limit.

**4. Run it from CI.**

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**, named `OPENROUTER_API_KEY`. Then **Actions → Benchmark →
Run workflow**, which runs the suite and commits the results back.

If the Actions tab shows the workflow but the run fails at the commit step,
check **Settings → Actions → General → Workflow permissions** is set to *Read
and write*.

## Running it for free

The whole thing is designed to cost nothing to operate.

* **Models** are OpenRouter `:free` variants.
* **Compute** runs in GitHub Actions, which is unmetered for public
  repositories.
* **Storage** is a JSON file committed back to the repo. There is no database,
  because the results only ever need to be read exactly as they were last
  written, and a portfolio project that provisions a database is answering a
  question nobody asked.

The one thing worth knowing: OpenRouter allows **50 free requests a day**, and
**1,000 a day** once you have bought $10 of credits at any point in the past.
The balance can go back to zero afterwards and the higher limit stays. That
one-off $10 is the difference between a suite of 8 tasks against 1 model and a
suite of 8 tasks against 5 models with 5 repeats, which is 200 requests before
the judge is counted.

The runner is paced to **18 requests a minute** against a limit of 20, shared
across every worker. Judge calls come out of the same budget, and sitting
exactly on a limit means every clock skew becomes a 429. Running more workers
than the limit does not finish the suite faster, it finishes it with holes.

---

## The benchmark workflow

`.github/workflows/nightly.yml` runs the suite and commits the results. Add
`OPENROUTER_API_KEY` as a repository secret and it needs nothing else.

**It is started by hand and has no schedule**, which is deliberate. It ran
nightly, and that was wrong twice over. The free allowance is daily and shared
with every other project on the same key, so a batch nobody asked for competes
with the run someone is waiting on. And a scheduled job with permission to push
publishes a measurement nobody watched: free model availability changes
constantly — models get retired, throttled, or quietly swapped for a smaller
variant — so a leaderboard can reorder itself overnight, and the commit log
would be the only notice anyone got. Measuring is a decision, so a person takes
it.

Results land in:

* `results/latest.json` — the machine-readable report
* `results/latest.md` — the same thing, readable in the repo
* `results/history/` — one file per run, so drift over time is visible

Nothing reads `latest.json` automatically. The console derives its model page
from the committed browser runs instead, and the portfolio site builds its chart
from the same records — so this suite's output is read by a person, which is the
only honest arrangement for a number nobody is watching get produced.

Free model availability changes constantly. Models get retired, throttled, or
quietly swapped for a smaller variant. The history directory is there because
a leaderboard that only shows today cannot tell you that a model got worse.

---

## Tests

```bash
pytest -q
```

39 tests, no network. Every grader, the interval maths, the ranking, and the
rate limiter are tested against the mistakes rather than the happy path:

* `test_three_of_three_is_not_reported_as_certainty`
* `test_transport_failures_are_dropped_rather_than_scored_zero`
* `test_overlap_is_not_transitive`
* `test_unparseable_judge_output_fails_closed`
* `test_numeric_takes_the_last_number_not_the_first`

## Built on

[polyact](https://github.com/iamwaleediqbal/polyact), and in two ways worth
telling apart.

**As a dependency.** The Python suite uses its OpenRouter client and its token
normalisation, so cached and reasoning tokens are counted the same way whichever
provider served the request — and every completion carries polyact's zero price
ceiling, which the provider enforces by refusing rather than by billing.

**As a specification.** The Playwright runner is TypeScript and cannot import a
Python package, so it does the next best thing: it is tested against polyact's
published coordinate vectors. `web/tests/conformance.test.ts` reads
`conformance/coordinates.json` — vendored under `web/lib/environment/vendor/`,
with its provenance in the file — and asserts that this runner converts every
case identically, and that its own table of which model answers in which space
agrees with polyact's.

That matters because the failure it guards is silent. Gemini's computer-use
models answer on a 0-1000 grid; Anthropic's and OpenAI's answer in the pixels of
the screenshot you sent. Read one as the other and every click lands in the
top-left quarter of the screen — nothing raises, no request fails, and the run
records a model that appears unable to see. It cost a real paid run here before
the rule existed, and the provider had documented the answer the whole time.

A model with nothing published about its coordinate space is not guessed at. The
first coordinate that can only mean one thing settles it, an ambiguous one is
hit-tested against the live page, and neither costs a model turn or a token —
which is why the free models on the roster stay free.

## License

MIT
