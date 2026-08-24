#!/usr/bin/env bash
# Build earpop-capture for this host and stage into npm/<platform-package>/bin/.
# Cross-platform release binaries are produced by CI (see .github/workflows/capture.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cargo build --release -p earpop-capture
node "$ROOT/scripts/stage-capture.mjs" --host
