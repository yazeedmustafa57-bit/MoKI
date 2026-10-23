#!/usr/bin/env bash
set -euo pipefail
export PREVIEW_MODE=true
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/start.sh"
