#!/usr/bin/env bash
#
# Record real runs, one task at a time, and write them into public/runs/.
#
# This belongs to the harness, and only to the harness. The gym is a separate
# deployed application in a separate repository; it holds state and publishes a
# contract, and it has no idea that runs, tasks, graders or models exist. This
# script reaches it over HTTP the way any other visitor would.
#
# Nothing runs without you saying so. Each task shows you its instruction, waits
# for you to approve it, records it, then shows you the outcome and the quota it
# spent before offering the next one. You can stop after any task and keep
# everything recorded so far.
#
# Everything this produces is measured: a real Chromium, real clicks, real
# screenshots, a real model. If a model is unreachable the run is recorded as an
# infrastructure failure and stays unscored, because a transport failure is an
# absent measurement rather than a model that failed.
#
# By default it cannot spend credits, and that is a capability rather than a
# rule: every request carries a zero price ceiling the provider enforces by
# refusing rather than billing, the model list rejects any model with a non-zero
# price in any field, a reply reporting a cost aborts the run, and the credit
# balance is compared before and after. Spending requires naming a paid model
# and a budget in the same breath — see below.
#
# Usage:
#   ./record-runs.sh                  offer every task in turn
#   ./record-runs.sh triage           just this one
#   ./record-runs.sh triage reply-only    these two, one budget between them
#   ./record-runs.sh --all            no prompting, run everything
#   ./record-runs.sh --models         show the model chain, spend nothing
#   MODE=tool ./record-runs.sh        the semantic action space instead
#   MODE=both ./record-runs.sh        both spaces per task, for the comparison
#   GYM_URL=… ./record-runs.sh        drive a local gym instead of the deployed one
#   MODEL=… ./record-runs.sh          a specific model instead of the free router
#
# Spending is opt-in and bounded. A paid model requires BUDGET as well, so
# choosing to spend and choosing how much are one decision:
#
#   BUDGET=0.30 MODEL=google/gemini-3.7-flash MODE=both ./record-runs.sh
#
# Size the budget to what you are actually running. It is a stop-loss, not a
# spend target, but one set an order of magnitude above anything reachable is
# not bounding the run — the per-task turn cap is, and the number is decoration.
# The worst cases, at every task's full turn ceiling:
#
#   one task, one space      ~22 turns     BUDGET=0.05
#   one task, both spaces    ~34 turns     BUDGET=0.05
#   whole suite, one space  ~130 turns     BUDGET=0.20
#   whole suite, both        ~208 turns    BUDGET=0.30
#
# Real runs come in well under, because a task that is going correctly finishes
# long before its ceiling. The first paid turn prints what it cost and what that
# implies for the task's ceiling, so after one turn you are working from a
# measurement rather than from this table.
#
# The batch stops the moment the running total reaches the budget, mid-task if
# necessary. Without MODEL set to a paid id, nothing can cost anything: every
# request carries a zero price ceiling the provider enforces by refusing.
#
# BUDGET is per invocation, not per lifetime. Each run of this script starts a
# fresh accounting session anchored to the account's current spend, so calling
# it three times with BUDGET=0.30 authorises up to 0.90 in total. There is no
# stored lifetime ceiling anywhere and this script cannot invent one — the
# number to watch is the OpenRouter balance, which it prints before and after.
#
# Computer use needs a model that accepts images. The free router picks one; a
# text-only MODEL will simply not see the screenshots.
#
# The roster. Recording a second model ADDS a column; it never replaces the
# first, because a run is keyed on task, action space and model together.
#
# The estimates were not guesses. One full suite of Gemini — six tasks, both
# spaces, twelve runs — moved 342k prompt tokens and 15.7k completion tokens,
# so any model's suite is that shape priced at its own rate. Gemini's own bill
# came in at $0.13 against a $0.32 list projection, because OpenRouter routes
# to the cheapest endpoint that satisfies the price ceiling, so a list figure
# is a ceiling rather than an expectation.
#
# What is actually committed under public/runs, and what it cost:
#
#   MODEL                                  RUNS  tool  cu    actual
#   openai/gpt-5.6-luna                      12   6     6    $0.0426
#   google/gemini-3.7-flash                  12   6     6    $0.1297
#   meta/muse-glimmer-30b                    12   6     6    $0.1331
#   anthropic/claude-sonnet-5                 4   2     2    $0.3485
#   dots-studio/dots-3-note-preview:free      8   6     2    $0.0000
#                                            --                -----
#                                            48              $0.6539
#
# Two departures from the plan, both worth naming rather than hiding. The
# fourth slot was to be deepseek-v4-flash-vision-exp; its data policy returned
# 404 for this account, so muse-glimmer-30b took the slot. And Claude was
# planned as computer use only on cost grounds — at $2 and $10 per million it
# is an order of magnitude dearer than the rest — but it ran two of each and
# then hit the cap, which is why its column is the short one. Its cost per run
# is 25x the cheapest model here, and the money went into turns: it averaged
# 11.5 turns a run against gpt-5.6-luna's 7.1, and computer use re-sends the
# accumulated screenshots every turn.
#
# The short columns are not padded to match. Two attempts is reported as two
# attempts and shows up as a wide interval, because inventing four more runs
# to square the table is the one thing an eval must never do.
#
# Free models need no BUDGET and cannot spend: every request carries a zero
# price ceiling the provider enforces by refusing rather than billing. The free
# tier allows 20 requests a minute, and 1000 a day once the account has $10 in
# lifetime credits (50 a day below that) — a whole suite is under a hundred
# requests, so the daily figure is the one that decides whether this is
# possible, and on a funded account it is not close.
#
# Coordinates are handled per model and none of it is configured here:
#
#   Gemini and the Qwen-family grounding models document a 0-1000 grid; OpenAI
#   and Anthropic document the pixels of the image supplied. That declaration is
#   a prior, applied on the first turn before any coordinate exists to look at.
#
#   A coordinate that can only be read one way overrides the declaration, and an
#   ambiguous one from a model with no declaration is settled by hit-testing
#   both readings against the page that is already open.
#
#   So the free models above, which publish nothing about their coordinate
#   space, are resolved from evidence rather than guessed at — and it costs no
#   model turn and no tokens, only a line in the log. Adding one cannot change
#   how Gemini's coordinates are read; tests/computer.test.ts pins the whole
#   roster so that an edit which would is caught before a run pays for it.
#
# Playwright is a development dependency only. It lives in runner/, which has
# its own manifest so the root install never sees it, and .vercelignore keeps it
# out of the deployment entirely.
#
# Written for bash 3.2, which is what macOS ships. No associative arrays, and
# no empty command lists in a case branch — `y|Y) ;;` parses on bash 5 and is a
# syntax error on 3.2, so every empty branch is an explicit `:` instead.

set -eu

case "${1:-}" in
  -h|--help) sed -n '3,118p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --models)
    # Which models a run would try, without starting one or spending anything.
    cd "$(dirname "$0")"
    OPENROUTER_API_KEY="$(node runner/read-env.mjs OPENROUTER_API_KEY || true)" \
      node --experimental-strip-types runner/run.ts --models --mode "${MODE:-computer}"
    exit 0
    ;;
esac

cd "$(dirname "$0")"

# Defined before anything can call them. `die` was used by the MODE check and
# the argument loop below while its definition sat forty lines further down, so
# a bad MODE reported "die: command not found" instead of the message written
# for exactly that case — the one path where being told what went wrong matters
# most, because nothing has run yet and everything still can.
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m\u2713\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31m\u2717 %s\033[0m\n\n' "$1" >&2; exit 1; }

MODEL="${MODEL:-openrouter/free}"
MODE="${MODE:-computer}"
PAID_RUN=""
TASK_LIST="${TMPDIR:-/tmp}/agentscore-tasks.$$.tsv"
# One file for the whole session. The runner is spawned once per task, so a
# spend total held in memory would reset each time and a batch budget would
# quietly become a per-task budget.
BUDGET_STATE="${TMPDIR:-/tmp}/agentscore-budget.$$.json"

case "$MODE" in
  computer|tool|both) : ;;
  *) die "MODE must be computer, tool or both — got \"$MODE\"" ;;
esac

# Any number of task ids, because one budget should buy one batch.
#
# This took a single id, so recording five of the six tasks meant five separate
# invocations — and BUDGET is per invocation, so five runs of `BUDGET=0.30`
# authorise 1.50. The alternative was dividing the budget by hand into figures
# that mean nothing individually. A list keeps it one batch with one ceiling,
# and leaves the tasks you did not name exactly as they were.
ONLY=""
ASSUME_YES=""
for arg in "$@"; do
  case "$arg" in
    --all) ASSUME_YES="yes" ;;
    -*)    die "unknown option \"$arg\" — try --help" ;;
    *)     ONLY="$ONLY $arg" ;;
  esac
done

cleanup() {
  rm -f "$TASK_LIST" "$BUDGET_STATE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- preflight

say "Checking the environment"

command -v node >/dev/null 2>&1 || die "node is not installed"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  die "node 22 or newer is required (found $(node -v)). The runner uses --experimental-strip-types."
fi
ok "node $(node -v)"

[ -f .env.local ] || die ".env.local is missing. Run: cp .env.example .env.local, then put your OpenRouter key in it."

# Read the key without sourcing the file: sourcing a dotenv runs whatever is in
# it, and stripping quotes with sed costs more than handing it to node.
KEY="$(node runner/read-env.mjs OPENROUTER_API_KEY || true)"
case "$KEY" in
  "")     die "OPENROUTER_API_KEY is not set in .env.local" ;;
  *...*)  die "OPENROUTER_API_KEY is still the placeholder from .env.example" ;;
esac
[ ${#KEY} -ge 20 ] || die "OPENROUTER_API_KEY looks too short to be a real key"
ok "OpenRouter key found (${#KEY} characters)"

export OPENROUTER_API_KEY="$KEY"
export MODEL
export BUDGET="${BUDGET:-0}"
export BUDGET_STATE

# Say plainly which mode this is, because the two differ in whether the run can
# cost anything and that is not something to discover afterwards.
case "$MODEL" in
  openrouter/free|*:free)
    PAID_RUN=""
    ok "free models only — requests carry a zero price ceiling"
    ;;
  *)
    if [ "$(node -e "process.stdout.write(String(Number(process.env.BUDGET) > 0))")" != "true" ]; then
      die "$MODEL is a paid model. Set BUDGET to the most you will spend: BUDGET=0.30 MODEL=$MODEL $0"
    fi
    PAID_RUN="yes"
    warn "PAID MODEL: $MODEL, capped at ${BUDGET} credits for this invocation"
    warn "the total accumulates across tasks and is anchored to OpenRouter's own"
    warn "account figure, so it holds even if a reply reports no cost"
    warn "it does NOT accumulate across invocations — running this again"
    warn "authorises another ${BUDGET}"
    ;;
esac

# ---------------------------------------------------------------- quota

say "Checking the quota before spending any of it"

QUOTA_JSON="$(curl -sS --max-time 15 https://openrouter.ai/api/v1/auth/key \
  -H "Authorization: Bearer ${KEY}" || true)"

if [ -z "$QUOTA_JSON" ]; then
  warn "could not reach OpenRouter to check the quota — continuing"
else
  node -e '
    let payload = {};
    try { payload = JSON.parse(process.argv[1]); } catch { process.exit(0); }
    const d = payload.data || {};
    const bits = [];
    // limit_remaining is CREDITS left on the key, not requests. Labelling it
    // "requests" made a $1 spending cap read as "1 request left", which is a
    // very different thing to see just before deciding whether to run a batch.
    if (typeof d.limit_remaining === "number" && d.limit_remaining >= 0) {
      bits.push("$" + d.limit_remaining + " of key credit left");
    } else if (d.limit === null || d.limit === undefined) {
      bits.push("no spending cap on this key");
    }
    // Lifetime spend on the key, not this session. Reported so the figure at
    // the end can be compared against it; the delta is what matters.
    if (typeof d.usage === "number") {
      bits.push(d.usage === 0 ? "no credits used" : d.usage.toFixed(8) + " credits used to date");
    }
    // A negative or absent figure is the sentinel for "no limit on this
    // interval", which is what a key with purchased credits gets. Printing it
    // literally reads as "-1 per 10s", which is not a limit anyone has.
    if (d.rate_limit && typeof d.rate_limit.requests === "number" && d.rate_limit.requests > 0) {
      bits.push(d.rate_limit.requests + " per " + (d.rate_limit.interval || "interval"));
    }
    bits.push(d.is_free_tier ? "free tier (50/day)" : "credits purchased (1000/day)");
    console.log("  ✓ " + bits.join(", "));
    if (d.limit_remaining === 0) { console.error("  ! no requests left"); process.exit(3); }
  ' "$QUOTA_JSON" || die "the key has no requests left. It resets on its own."
fi

STARTING_CREDITS="$(printf '%s' "$QUOTA_JSON" | node -e '
  let raw = ""; process.stdin.on("data", c => raw += c).on("end", () => {
    try { process.stdout.write(String(JSON.parse(raw).data?.usage ?? "")); } catch {}
  });' || true)"

# ---------------------------------------------------------------- install

say "Installing"

# Checked, not assumed. `[ -d node_modules ] || npm install` printed a green
# tick whether or not the install worked — npm creates the directory before it
# starts fetching, so a failed install leaves exactly the evidence this line was
# reading as success. A tick that cannot fail is not a check.
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund || die "npm install failed — see the output above"
fi
# A file, not the directory. npm builds the whole directory tree before it
# fetches a single tarball, so an install that dies on the network leaves
# `node_modules/next/` sitting there, empty, looking exactly like a good one.
[ -f node_modules/next/package.json ] \
  || die "node_modules is incomplete — run 'npm install' and check it finishes"
ok "app dependencies"

npm --prefix runner install --silent --no-audit --no-fund \
  || die "the runner's dependencies would not install — see the output above"
[ -x ./runner/node_modules/.bin/playwright ] \
  || die "playwright is missing from runner/node_modules — run 'npm --prefix runner install'"
ok "runner dependencies"

# The task table, read straight out of the task definitions so this menu and the
# runner can never disagree about what exists.
#
# Here rather than further down, because `--list` needs the runner's own
# dependencies and nothing else. Validating a named task after the browser
# download and a dev-server boot meant a typo cost two minutes to be told it was
# a typo.
node --experimental-strip-types runner/run.ts --list > "$TASK_LIST"

# Every name checked before anything installs a browser. A typo in the fifth id
# should not cost two minutes of setup to be told about.
for want in $ONLY; do
  if ! cut -f1 "$TASK_LIST" | grep -qx "$want"; then
    printf '\n'
    cut -f1 "$TASK_LIST" | sed 's/^/    /'
    die "no task named \"$want\". The ids are listed above."
  fi
done
# An `if`, not `[ … ] && …`. Under `set -e` the AND-list form is exempt only
# because the test sits in a non-final position, which is a rule worth not
# depending on in a script that spends money.
if [ -n "$ONLY" ]; then
  ok "recording:$ONLY"
fi

# Playwright ships its browser separately. Installing twice is cheap; not
# installing at all fails deep inside the first run with an unhelpful message.
# The tick belongs in the branch that earned it. This printed the warning and
# then "✓ Chromium" underneath it, which reads as recovered rather than failed.
if ./runner/node_modules/.bin/playwright install chromium >/dev/null 2>&1; then
  ok "Chromium"
else
  warn "could not install Chromium automatically — the first run will fail on it"
  warn "run: ./runner/node_modules/.bin/playwright install chromium"
fi

# ------------------------------------------------------------------- gym

# The environment is a deployed application in its own repository, so there is
# nothing to start here. That is the arrangement rather than a convenience: the
# harness reaches the gym over HTTP with no privileged access and no shared
# process, which is the only way "it could drive a real application" means
# anything.
#
# Point GYM_URL at a local clickmail checkout while you are working on one.
GYM_URL="${GYM_URL:-https://clickmail-sigma.vercel.app/gym}"

# The mailbox is at /gym; the site root is a landing page that publishes no
# contract. Corrected rather than rejected, because copying the address bar out
# of a browser gives you the bare origin — and because this check must test the
# same URL the runner will actually open.
case "$GYM_URL" in
  */gym|*/gym/) : ;;
  *)            GYM_URL="${GYM_URL%/}/gym" ;;
esac

say "Checking the environment is reachable"
printf '  %s\n' "$GYM_URL"

if ! curl -sSf -o /dev/null --max-time 20 "$GYM_URL" 2>/dev/null; then
  die "cannot reach $GYM_URL — is it deployed? For a local gym: GYM_URL=http://localhost:3000/gym $0"
fi
ok "the gym answers"

export GYM_URL

# ---------------------------------------------------------------- run

if [ "$MODE" = "both" ]; then
  say "Recording — computer use and tool calling, per task"
else
  say "Recording — ${MODE} mode"
fi
printf '  Nothing runs until you say so. y = run it, n = skip, q = stop and keep what is recorded.\n'

RECORDED=0
SKIPPED=0

# Read the task table on fd 3 so stdin stays free for your answers — a plain
# `while read` loop would swallow the prompt's input instead.
exec 3< "$TASK_LIST"
while IFS="$(printf '\t')" read -r TASK_ID TASK_TITLE TASK_PROMPT <&3; do
  [ -n "$TASK_ID" ] || continue
  # Membership, not equality. Padded on both sides so `triage` cannot match
  # inside a longer id that happens to contain it.
  if [ -n "$ONLY" ]; then
    case " $ONLY " in
      *" $TASK_ID "*) : ;;
      *)              continue ;;
    esac
  fi

  printf '\n\033[1m  %s\033[0m  (%s)\n' "$TASK_TITLE" "$TASK_ID"
  printf '  instruction: %s\n' "$TASK_PROMPT"

  if [ -n "$ASSUME_YES" ]; then
    ANSWER="y"
  else
    printf '  run it? [y/N/q] '
    read -r ANSWER < /dev/tty || ANSWER="q"
  fi

  case "$ANSWER" in
    q|Q) printf '\n  stopping here.\n'; break ;;
    y|Y) : ;;
    *)   printf '  skipped.\n'; SKIPPED=$((SKIPPED + 1)); continue ;;
  esac

  # MODE=both records the same task twice, once in each action space. They
  # share a starting state and a grader and differ only in what the model is
  # shown, so the gap between the two verdicts is the part of the difficulty
  # that is grounding rather than comprehension — which is the comparison this
  # whole project exists to make.
  case "$MODE" in
    both) RUN_MODES="computer tool" ;;
    *)    RUN_MODES="$MODE" ;;
  esac

  TASK_OK=""
  for RUN_MODE in $RUN_MODES; do
    [ "$MODE" = "both" ] && printf '  \033[2m— %s —\033[0m\n' "$RUN_MODE"

    # --append so recording one task never discards the ones before it, and so
    # the second action space does not overwrite the first.
    RUN_STATUS=0
    node --experimental-strip-types runner/run.ts \
      --mode "$RUN_MODE" --task "$TASK_ID" --append || RUN_STATUS=$?

    if [ "$RUN_STATUS" -eq 0 ]; then
      TASK_OK="yes"
    elif [ "$RUN_STATUS" -eq 3 ]; then
      # The quota or the budget is gone. Every remaining task would spend a
      # request to be told the same thing, so the session ends here — including
      # under --all, where nobody is at the keyboard to stop it.
      warn "the quota or budget is spent — stopping the session"
      STOP="yes"
      break
    else
      warn "that run recorded nothing — see the reason above"
      if [ -z "$ASSUME_YES" ]; then
        printf '  keep going? [y/N] '
        read -r CONTINUE < /dev/tty || CONTINUE="n"
        case "$CONTINUE" in
          y|Y) : ;;
          *)   printf '\n  stopping here.\n'; STOP="yes"; break ;;
        esac
      fi
    fi
  done

  [ -n "$TASK_OK" ] && RECORDED=$((RECORDED + 1))
  [ -n "${STOP:-}" ] && break
done
exec 3<&-

# ---------------------------------------------------------------- report

say "What is on disk"

node -e '
const fs = require("fs");
let index;
try { index = JSON.parse(fs.readFileSync("public/runs/index.json", "utf8")); }
catch { console.log("  nothing recorded"); process.exit(0); }
const runs = index.runs || [];
if (!runs.length) { console.log("  nothing recorded"); process.exit(0); }
let shots = 0;
for (const run of runs) {
  const pics = run.entries.filter((e) => e.entry_type === "action" && e.screenshot).length;
  shots += pics;
  console.log(
    "  " + run.taskTitle.padEnd(34) +
    String(run.verdict ? run.verdict.status : run.status).padEnd(21) +
    String(run.turns) + " turns  " + String(run.tokens.total) + " tokens  " + pics + " screenshots",
  );
}
console.log("");
console.log("  " + runs.length + " run(s), " + shots + " screenshot(s)");
'

FINAL_CREDITS="$(curl -sS --max-time 15 https://openrouter.ai/api/v1/auth/key \
  -H "Authorization: Bearer ${KEY}" 2>/dev/null | node -e '
  let raw = ""; process.stdin.on("data", c => raw += c).on("end", () => {
    try { process.stdout.write(String(JSON.parse(raw).data?.usage ?? "")); } catch {}
  });' || true)"

# On a paid run credits are *supposed* to move, and the alarm below is for the
# free path only. Firing it on an expected charge is worse than not checking at
# all: a warning that cries wolf is one nobody reads on the day it is right.
if [ -n "$STARTING_CREDITS" ] && [ -n "$FINAL_CREDITS" ]; then
  if [ -n "$PAID_RUN" ]; then
    node -e '
      const [before, after, budget] = process.argv.slice(1).map(Number);
      const delta = after - before;
      console.log(`  \u001b[32m✓\u001b[0m spent ${delta.toFixed(6)} credits of ${budget} budgeted`);
      console.log(`    account total: ${before.toFixed(6)} → ${after.toFixed(6)}`);
    ' "$STARTING_CREDITS" "$FINAL_CREDITS" "$BUDGET"
  elif [ "$STARTING_CREDITS" = "$FINAL_CREDITS" ]; then
    ok "credits spent: none (${FINAL_CREDITS} used, unchanged)"
  else
    warn "credits moved: ${STARTING_CREDITS} → ${FINAL_CREDITS}"
    warn "this was a free run, so that should be impossible. Do not re-run until you know why."
  fi
fi

SIZE="$(du -sh public/runs 2>/dev/null | cut -f1)"
say "public/runs is ${SIZE} — recorded ${RECORDED}, skipped ${SKIPPED}"

KB="$(du -sk public/runs 2>/dev/null | cut -f1)"
if [ -n "$KB" ] && [ "$KB" -gt 20480 ]; then
  warn "that is over 20MB — it ships with every deploy. Drop older recordings first."
fi

cat <<'NOTE'

  Committing publishes these to every visitor:

    git add public/runs
    git commit -m "Record real Chromium runs"
    git push

  Deleting public/runs/index.json takes them down again.

NOTE
