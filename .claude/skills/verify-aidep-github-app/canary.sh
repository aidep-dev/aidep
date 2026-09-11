#!/usr/bin/env bash
# aidep's GitHub App, driven in production through the canary repo with gh.
# Production is the instance, so there is nothing to start or stop.
#
#   run                 start a run: a new artifacts dir, recorded as current; prints it
#   art                 print the current run's absolute artifacts dir
#   doctor              read-only: are production and the canary worth driving
#   probe-add [model]   commit verify/probe.py to main, one chat call to <model> on line 7
#                       (default gpt-4o-transcribe); prints the commit sha
#   probe-remove        delete verify/probe.py from main; prints the sha, or "absent"
#   refresh [seconds]   tick the onboarding PR's refresh box, wait up to <seconds> (default 180)
#                       for aidep to re-render the PR, then print its "What we found" section
#   found               print the onboarding PR's "What we found" section as it stands
#   untick              put the refresh box back when a refresh never came back
#
# AIDEP_CANARY picks the repo (default ricardodreyes/aidep-canary).
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "$0")" && pwd)
CANARY=${AIDEP_CANARY:-ricardodreyes/aidep-canary}
RUN_DIR=$SKILL_DIR/.run
CURRENT=$RUN_DIR/current
PROBE=verify/probe.py
UNTICKED='- [ ] <!-- aidep-rebase -->'
TICKED='- [x] <!-- aidep-rebase -->'

failed=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failed=1; }

onboarding_pr() {
  gh pr list --repo "$CANARY" --state all --head aidep/configure --json number --jq '.[0].number // empty'
}
pr_body() { gh pr view "$1" --repo "$CANARY" --json body --jq .body; }
pr_updated() { gh pr view "$1" --repo "$CANARY" --json updatedAt --jq .updatedAt; }
found_section() { awk '/^## What we found/{on=1} /^## What happens after you merge/{on=0} on'; }
probe_sha() {
  local sha
  if sha=$(gh api "repos/$CANARY/contents/$PROBE?ref=main" --jq .sha 2>/dev/null); then echo "$sha"; fi
}
# prints the PR's updated_at after the edit, so a caller can ignore bodies older than it
set_marker() {
  pr_body "$1" | FROM="$2" TO="$3" node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      process.stdout.write(JSON.stringify({ body: s.replace(process.env.FROM, process.env.TO) }));
    });' | gh api -X PATCH "repos/$CANARY/pulls/$1" --input - --jq .updated_at
}

case "${1:-}" in

run)
  art=$SKILL_DIR/artifacts/$(date +%Y%m%d-%H%M%S)
  mkdir -p "$art" "$RUN_DIR"
  echo "$art" > "$CURRENT"
  echo "$art"
  ;;

art)
  [ -f "$CURRENT" ] || { echo "no run started: canary.sh run" >&2; exit 1; }
  cat "$CURRENT"
  ;;

doctor)
  command -v gh >/dev/null 2>&1 || { fail "gh is not installed here; nothing below can run"; exit 1; }
  if login=$(gh api user --jq .login 2>/dev/null); then pass "gh is signed in as $login"; else fail "gh cannot reach GitHub as anyone"; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://api.github.com/apps/aidep-dev || true)
  case "$code" in
    200) pass "the aidep-dev App is public" ;;
    404) fail "the aidep-dev App is private: it installs on its own org only" ;;
    *) fail "api.github.com/apps/aidep-dev answered ${code:-nothing}: no route to GitHub from here" ;;
  esac
  push=$(gh api "repos/$CANARY" --jq .permissions.push 2>/dev/null || true)
  if [ "$push" = true ]; then pass "gh can push to $CANARY"; else fail "gh cannot push to $CANARY (push=${push:-unreadable})"; fi
  n=$(onboarding_pr 2>/dev/null || true)
  if [ -z "$n" ]; then
    fail "no onboarding PR (head aidep/configure) on $CANARY: the App is not installed there"
  else
    state=$(gh pr view "$n" --repo "$CANARY" --json state --jq .state)
    if [ "$state" = MERGED ]; then pass "onboarding PR #$n is merged"; else fail "onboarding PR #$n is $state: the repo is not onboarded"; fi
    b=$(pr_body "$n")
    if [[ "$b" == *"$UNTICKED"* ]]; then pass "onboarding PR #$n refresh box is unticked"; else fail "onboarding PR #$n refresh box is not unticked: a refresh never came back (canary.sh untick)"; fi
  fi
  if gh api "repos/$CANARY/contents/.github/aidep.json?ref=main" --jq .content 2>/dev/null | base64 -d 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s))' 2>/dev/null; then
    pass ".github/aidep.json on main parses"
  else
    fail ".github/aidep.json on main is missing or not JSON"
  fi
  if [ -z "$(probe_sha)" ]; then pass "no probe on main"; else fail "$PROBE is on main from an earlier run (canary.sh probe-remove)"; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://aidep.dev/api/registry || true)
  case "$code" in
    200) pass "aidep.dev/api/registry answers 200" ;;
    000|"") fail "no route to aidep.dev from here" ;;
    *) fail "aidep.dev/api/registry answered $code" ;;
  esac
  health=$(gh run list --repo aidep-dev/aidep --workflow health.yml --limit 1 --json conclusion,createdAt --jq '.[0] | "\(.conclusion) at \(.createdAt)"' 2>/dev/null || true)
  case "$health" in
    success*) pass "last health probe: $health" ;;
    *) fail "last health probe: ${health:-unreadable}" ;;
  esac
  exit $failed
  ;;

probe-add)
  model=${2:-gpt-4o-transcribe}
  [ -z "$(probe_sha)" ] || { echo "$PROBE is already on main; canary.sh probe-remove first" >&2; exit 1; }
  content=$(printf '%s\n' \
    'from openai import OpenAI' \
    '' \
    'client = OpenAI()' \
    '' \
    '' \
    'def probe(prompt: str) -> str:' \
    "    r = client.chat.completions.create(model=\"$model\", messages=[{\"role\": \"user\", \"content\": prompt}])" \
    '    return r.choices[0].message.content or ""' | base64 | tr -d '\n')
  gh api -X PUT "repos/$CANARY/contents/$PROBE" \
    -f message="verify: probe $model" -f content="$content" -f branch=main --jq .commit.sha
  ;;

probe-remove)
  sha=$(probe_sha)
  [ -n "$sha" ] || { echo absent; exit 0; }
  gh api -X DELETE "repos/$CANARY/contents/$PROBE" \
    -f message="verify: remove probe" -f sha="$sha" -f branch=main --jq .commit.sha
  ;;

refresh)
  wait_s=${2:-180}
  n=$(onboarding_pr)
  [ -n "$n" ] || { echo "no onboarding PR on $CANARY" >&2; exit 1; }
  b=$(pr_body "$n")
  [[ "$b" == *"$UNTICKED"* ]] || { echo "onboarding PR #$n has no unticked refresh box (canary.sh untick)" >&2; exit 1; }
  ticked_at=$(set_marker "$n" "$UNTICKED" "$TICKED")
  deadline=$((SECONDS + wait_s))
  while :; do
    sleep 5
    b=$(pr_body "$n")
    if [[ "$b" == *"$UNTICKED"* && ! "$(pr_updated "$n")" < "$ticked_at" ]]; then break; fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "onboarding PR #$n was not re-rendered within ${wait_s}s; the 10-minute cron drain is the fallback, so check canary.sh found later" >&2
      exit 1
    fi
  done
  printf '%s\n' "$b" | found_section
  ;;

found)
  n=$(onboarding_pr)
  [ -n "$n" ] || { echo "no onboarding PR on $CANARY" >&2; exit 1; }
  pr_body "$n" | found_section
  ;;

untick)
  n=$(onboarding_pr)
  [ -n "$n" ] || { echo "no onboarding PR on $CANARY" >&2; exit 1; }
  b=$(pr_body "$n")
  if [[ "$b" == *"$TICKED"* ]]; then
    set_marker "$n" "$TICKED" "$UNTICKED" >/dev/null
    echo "unticked #$n"
  else
    echo "already unticked"
  fi
  ;;

*)
  sed -n '2,16p' "$0" >&2
  exit 1
  ;;
esac
