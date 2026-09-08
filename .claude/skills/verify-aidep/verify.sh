#!/usr/bin/env bash
# One verification instance of aidep: a production build served by `next start`
# on its own port, so the dev server on :3000 is never driven or killed.
#
#   up [--no-build]   build, start on the port, wait for /api/registry, record the run
#   doctor            read-only: is the instance we started still the one worth driving
#   art               print this run's absolute artifacts dir
#   sql "<query>"     one query against the docker postgres (the dev server and tests share it)
#   down              stop what `up` started; artifacts stay
#
# AIDEP_VERIFY_PORT picks the port (default 3100). The run record is .run/<port>.env
# beside this script, so two instances on two ports can coexist.
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SKILL_DIR/../../.." && pwd)
PORT=${AIDEP_VERIFY_PORT:-3100}
RUN_DIR=$SKILL_DIR/.run
STATE=$RUN_DIR/$PORT.env
URL=http://localhost:$PORT

failed=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failed=1; }

listener() { lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true; }
db() { (cd "$ROOT" && docker compose exec -T db "$@"); }
registry_rows() {
  curl -sf --max-time 5 "$URL/api/registry" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))' 2>/dev/null \
    || echo 0
}

case "${1:-}" in
up)
  l=$(listener)
  if [ -n "$l" ]; then
    echo "port $PORT is already owned by pid $l ($(ps -o command= -p "$l" | cut -c1-60)); pick another with AIDEP_VERIFY_PORT" >&2
    exit 1
  fi
  db pg_isready -q 2>/dev/null || { echo "postgres is not up: run 'docker compose up -d' in $ROOT" >&2; exit 1; }
  reg=$(grep -E '^REGISTRY_SOURCE=' "$ROOT/.env.local" | cut -d= -f2-)
  case "$reg" in
    https://*) ;;
    *) [ -f "$ROOT/$reg/openai.json" ] || { echo "registry checkout missing at $ROOT/$reg (REGISTRY_SOURCE in .env.local)" >&2; exit 1; } ;;
  esac
  run_id=$(date +%Y%m%d-%H%M%S)
  art=$SKILL_DIR/artifacts/$run_id
  mkdir -p "$RUN_DIR" "$art"
  cd "$ROOT"
  if [ "${2:-}" != "--no-build" ]; then
    echo "building (npm run build, log: $art/build.log)"
    npm run build --silent >"$art/build.log" 2>&1 || { tail -30 "$art/build.log"; exit 1; }
  fi
  [ -f .next/BUILD_ID ] || { echo "no .next/BUILD_ID; run without --no-build" >&2; exit 1; }
  nohup node node_modules/.bin/next start -p "$PORT" >"$art/server.log" 2>&1 </dev/null &
  pid=$!
  head=$(git rev-parse --short HEAD)
  git diff --quiet || head="$head-dirty"
  {
    echo "PID=$pid"
    echo "PORT=$PORT"
    echo "URL=$URL"
    echo "BUILD_ID=$(cat .next/BUILD_ID)"
    echo "HEAD=$head"
    echo "STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "ARTIFACTS=$art"
  } >"$STATE"
  cp "$STATE" "$art/run.env"
  for _ in $(seq 1 40); do
    rows=$(registry_rows)
    [ "${rows:-0}" -gt 0 ] 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || { echo "server exited; see $art/server.log"; tail -20 "$art/server.log"; rm -f "$STATE"; exit 1; }
    sleep 1
  done
  [ "${rows:-0}" -gt 0 ] 2>/dev/null || { echo "$URL/api/registry never answered; see $art/server.log"; exit 1; }
  echo "up: $URL  build $(cat .next/BUILD_ID) from $head  registry rows: $rows"
  echo "artifacts: $art"
  ;;

doctor)
  [ -f "$STATE" ] || { echo "FAIL  no run recorded for port $PORT (run: verify.sh up)"; exit 1; }
  # shellcheck disable=SC1090
  . "$STATE"
  if kill -0 "$PID" 2>/dev/null; then pass "pid $PID alive (started $STARTED)"; else fail "pid $PID is gone"; fi
  l=$(listener)
  if [ -n "$l" ] && { [ "$l" = "$PID" ] || [ "$(ps -o ppid= -p "$l" | tr -d ' ')" = "$PID" ]; }; then
    pass "port $PORT listener $l is ours"
  else
    fail "port $PORT listener is '${l:-nobody}', not pid $PID or its child"
  fi
  rows=$(registry_rows)
  if [ "${rows:-0}" -gt 0 ] 2>/dev/null; then pass "$URL/api/registry answers with $rows rows"; else fail "$URL/api/registry did not answer"; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL/dead" || echo 000)
  if [ "$code" = 200 ]; then pass "$URL/dead renders 200 (needs the database)"; else fail "$URL/dead answered $code"; fi
  if [ "$(cat "$ROOT/.next/BUILD_ID")" = "$BUILD_ID" ]; then
    pass "serving build $BUILD_ID from $HEAD"
  else
    fail ".next was rebuilt since this instance started (serving $BUILD_ID); run down, then up"
  fi
  if db pg_isready -q 2>/dev/null; then pass "postgres on :5433 ready"; else fail "postgres on :5433 not ready"; fi
  echo "artifacts: $ARTIFACTS"
  exit $failed
  ;;

art)
  [ -f "$STATE" ] || { echo "no run recorded for port $PORT" >&2; exit 1; }
  grep '^ARTIFACTS=' "$STATE" | cut -d= -f2-
  ;;

sql)
  shift
  [ $# -gt 0 ] || { echo "usage: verify.sh sql \"<query>\"" >&2; exit 1; }
  db psql -U postgres -d aidep -tAc "$*"
  ;;

down)
  [ -f "$STATE" ] || { echo "nothing recorded for port $PORT"; exit 0; }
  # shellcheck disable=SC1090
  . "$STATE"
  pkill -TERM -P "$PID" 2>/dev/null || true
  kill -TERM "$PID" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
  kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
  rm -f "$STATE"
  echo "stopped pid $PID on port $PORT; artifacts kept at $ARTIFACTS"
  ;;

*)
  sed -n '2,12p' "$0"
  exit 1
  ;;
esac
