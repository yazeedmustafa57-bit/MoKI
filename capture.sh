#!/usr/bin/env bash
# Capture the exact preview URL in desktop and mobile viewports.
# Exit 75 = temporary browser/navigation infrastructure failure.
# Exit 1  = script, configuration or rendering defect.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"
cd "$PROJECT_DIR"

CAPTURE_URL="${CAPTURE_URL:?Set CAPTURE_URL to the exact URL to capture.}"
CAPTURE_DIR="${CAPTURE_DIR:?Set CAPTURE_DIR to an output directory outside the source tree.}"

RUNNER_TEMP_DIR="${RUNNER_TEMP:-/tmp}"
if [[ "$CAPTURE_DIR" == "$PROJECT_DIR" || "$CAPTURE_DIR" == "$PROJECT_DIR/"* ]]; then
  echo "CAPTURE_DIR must be outside the source tree: $CAPTURE_DIR" >&2
  exit 1
fi

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

run_timed "capture-prepare" mkdir -p "$CAPTURE_DIR"

export CAPTURE_URL CAPTURE_DIR PROJECT_DIR
run_timed "capture-browser" node --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.env.PROJECT_DIR;
const url = process.env.CAPTURE_URL;
const outputDir = process.env.CAPTURE_DIR;
const require = createRequire(join(projectDir, 'package.json'));
const { chromium } = require('playwright');

const startedAt = Date.now();
const timings = [];
const mark = (label, started) => {
  const ms = Date.now() - started;
  timings.push({ label, ms });
  console.log(`[timing] ${label}: ${ms} ms`);
};

class TransientCaptureError extends Error {}
class DefectCaptureError extends Error {}

let browser;
try {
  const launchStarted = Date.now();
  try {
    browser = await chromium.launch({ headless: true, timeout: 30000 });
  } catch (error) {
    throw new TransientCaptureError(`Browser launch failed: ${error.message}`);
  }
  mark('browser-launch', launchStarted);

  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
  ]) {
    const viewStarted = Date.now();
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(30000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const gotoStarted = Date.now();
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      throw new TransientCaptureError(`Navigation failed for ${name}: ${error.message}`);
    }
    mark(`${name}-navigation`, gotoStarted);

    const status = response?.status() ?? 0;
    if (!response) throw new TransientCaptureError(`No HTTP response for ${name} at ${url}`);
    if (status === 408 || status === 429 || status >= 500) {
      throw new TransientCaptureError(`Temporary HTTP ${status} for ${name} at ${url}`);
    }
    if (status >= 400) {
      throw new DefectCaptureError(`HTTP ${status} for ${name} at ${url}`);
    }

    const readyStarted = Date.now();
    try {
      await page.waitForSelector('#root > *', { state: 'visible', timeout: 30000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 });
      await page.waitForFunction(() => (document.body.innerText || '').trim().length > 0, null, {
        timeout: 15000,
      });
      await page.waitForTimeout(600);
    } catch (error) {
      throw new DefectCaptureError(`Rendered content did not appear for ${name}: ${error.message}`);
    }
    mark(`${name}-rendered`, readyStarted);

    if (pageErrors.length) {
      throw new DefectCaptureError(`Page errors for ${name}: ${pageErrors.join(' | ')}`);
    }

    const file = join(outputDir, `final-${name}.png`);
    const shotStarted = Date.now();
    try {
      await page.screenshot({ path: file, fullPage: false, timeout: 30000 });
    } catch (error) {
      throw new TransientCaptureError(`Screenshot failed for ${name}: ${error.message}`);
    }
    mark(`${name}-screenshot`, shotStarted);

    const bytes = statSync(file).size;
    if (bytes < 1024) {
      throw new DefectCaptureError(`Screenshot is suspiciously small for ${name}: ${bytes} bytes`);
    }
    console.log(`Captured ${name}: ${file} (${bytes} bytes)`);
    await page.close();
    mark(`${name}-total`, viewStarted);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = error instanceof TransientCaptureError ? 75 : 1;
} finally {
  if (browser) {
    const closeStarted = Date.now();
    await browser.close().catch((error) => {
      console.error(`Browser close failed: ${error.message}`);
      process.exitCode ||= 75;
    });
    mark('browser-close', closeStarted);
  }
  console.log(
    JSON.stringify({
      url,
      outputDir,
      totalMs: Date.now() - startedAt,
      timings,
    }),
  );
}
NODE
