#!/usr/bin/env bash
# Build and serve the application in the foreground. The controller owns the
# long-lived tmux session; this script owns dependency install, build and serve.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"
cd "$PROJECT_DIR"

PORT="${PORT:-${APP_PORT:-3000}}"
export PORT
export HOST="${HOST:-0.0.0.0}"
PRODUCTION_MODE_FILE="${PRODUCTION_MODE_FILE:-$PROJECT_DIR/config/public-production.env}"
if [[ -z "${PREVIEW_MODE+x}" && -f "$PRODUCTION_MODE_FILE" ]]; then
  production_preview_mode="$(sed -n 's/^[[:space:]]*PREVIEW_MODE[[:space:]]*=[[:space:]]*//p' "$PRODUCTION_MODE_FILE" | tail -n 1 | tr -d '[:space:]')"
  case "$production_preview_mode" in
    true|false) export PREVIEW_MODE="$production_preview_mode" ;;
  esac
fi
export PREVIEW_MODE="${PREVIEW_MODE:-true}"

WEB_DIR="${OPENCODE_WEB_DIR:-${RUNNER_TEMP:-/tmp}/omgithub-web}"
DIST_DIR="$PROJECT_DIR/dist"
DEPLOYMENT_FILE="$WEB_DIR/deployment-output.json"

mkdir -p "$WEB_DIR"

run_timed() {
  local label="$1"
  shift
  local started finished status
  started="$(date +%s%3N)"
  printf '[timing] %s: start\n' "$label"
  set +e
  "$@"
  status=$?
  set -e
  finished="$(date +%s%3N)"
  printf '[timing] %s: %d ms (exit %d)\n' "$label" "$((finished - started))" "$status"
  return "$status"
}

printf 'Project: %s\n' "$PROJECT_DIR"
printf 'Serving on: http://%s:%s (PORT=%s)\n' "$HOST" "$PORT" "$PORT"
printf 'Deployment output: %s\n' "$DEPLOYMENT_FILE"

if [[ ! -d node_modules ]] || [[ ! -x node_modules/.bin/vite ]]; then
  run_timed "npm-ci" npm ci --no-audit --no-fund --include=dev
else
  run_timed "npm-install" npm install --no-audit --no-fund --prefer-offline --include=dev
fi

run_timed "vite-build" npm run build

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "Build output missing: $DIST_DIR/index.html" >&2
  exit 1
fi

rm -f "$DEPLOYMENT_FILE"
run_timed "write-deployment-output" node -e '
  const { writeFileSync } = require("node:fs");
  const [file, project, directory] = process.argv.slice(1);
  writeFileSync(file, JSON.stringify({ project, directory }) + "\n");
' "$DEPLOYMENT_FILE" "$PROJECT_DIR" "$DIST_DIR"

export NODE_ENV="${NODE_ENV:-production}"
printf '[timing] server-start: starting foreground server at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exec node server/index.js
