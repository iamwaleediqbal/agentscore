#!/usr/bin/env bash
#
# Prove the deployed apps cannot spend anything.
#
# The design is that neither app has an API route at all, so no request to
# either can reach a model provider. That is a claim about what is deployed,
# which is not visible from this repository — so it is checked from outside,
# against the running sites, the way anyone else would probe them.
#
#   ./verify-deployment.sh https://agentscore-sigma.vercel.app https://clickmail-sigma.vercel.app
#
# It only reads. Every request it makes is one it expects to be refused or to
# return a static file.
#
# Written for bash 3.2, which is what macOS ships.

set -eu

HARNESS="${1:-}"
GYM="${2:-}"
[ -n "$HARNESS" ] || { printf 'usage: %s <harness-url> [gym-url]\n' "$0" >&2; exit 2; }
HARNESS="${HARNESS%/}"; GYM="${GYM%/}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED="yes"; }
bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
FAILED=""

# `|| true` and a sentinel, because `set -e` is on: an unreachable host makes
# curl exit 7, which killed the whole script with no output at all — the least
# useful possible response to "is my deployment up?".
code() {
  # curl already prints 000 when it cannot connect, so this only needs to stop
  # `set -e` from killing the script on its non-zero exit. Echoing a fallback as
  # well produced "000000", which matched no case and reported the failure as an
  # unrecognised status.
  RESULT="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || true)"
  case "$RESULT" in
    ''|*[!0-9]*) echo "000" ;;
    *)           echo "$RESULT" ;;
  esac
}

# The routes that used to exist. Any of them answering is a deployment running
# code this repository no longer contains.
GONE="/api/agent /api/session /api/models"

check_no_api () {
  for path in $GONE; do
    C="$(code -X POST "$1$path" -H 'Content-Type: application/json' -d '{}')"
    case "$C" in
      404|405) ok "$path is not there ($C)" ;;
      2*)      bad "$path ANSWERED ($C). Something is deployed that can spend a key." ;;
      000)     bad "$path could not be reached — the host went away mid-check" ;;
      *)       bad "$path returned $C — expected it to be absent" ;;
    esac
  done
}

bold "Harness — $HARNESS"
C="$(code "$HARNESS/")"
case "$C" in
  200) ok "the console is serving" ;;
  000) bad "could not reach $HARNESS at all — wrong URL, or not deployed"; printf '\n'; exit 1 ;;
  *)   bad "the console answered $C — is the URL right?"; printf '\n'; exit 1 ;;
esac
check_no_api "$HARNESS"

C="$(code "$HARNESS/runs/index.json")"
case "$C" in
  200) ok "the committed runs file is served — that is the evidence, and only a push changes it" ;;
  404) ok "no runs published yet (the console falls back to its samples)" ;;
  *)   bad "the runs file answered $C" ;;
esac

for page in /models /tasks /runs /graders /tools; do
  C="$(code "$HARNESS$page")"
  case "$C" in
    200) ok "$page renders" ;;
    *)   bad "$page answered $C" ;;
  esac
done

if [ -n "$GYM" ]; then
  bold "Environment — $GYM"
  C="$(code "$GYM/gym")"
  case "$C" in
    200) ok "the mailbox is public and serving" ;;
    *)   bad "/gym answered $C" ;;
  esac
  check_no_api "$GYM"
else
  printf '\n  (no gym url given — pass one to check it too)\n'
fi

if [ -n "$FAILED" ]; then
  printf '\n\033[31m✗ Not in the read-only posture.\033[0m\n'
  printf '  Neither app should have API routes or environment variables.\n'
  printf '  Vercel → Project → Settings → Environment Variables.\n\n'
  exit 1
fi

printf '\n\033[32m✓ Read-only. Neither deployment can reach a model provider.\033[0m\n'
printf '  Record runs locally instead:  ./record-runs.sh\n'
printf '  Then publish by pushing:      git add public/runs && git commit && git push\n\n'
