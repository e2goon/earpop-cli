#!/usr/bin/env bash
# Build earpop-capture and copy into vendor/ for npm packaging.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-host}"

mkdir -p vendor

build_one() {
  local target="$1"
  local out_name="$2"
  echo "Building $out_name ($target)..."
  rustup target add "$target" >/dev/null 2>&1 || true
  cargo build --release -p earpop-capture --target "$target"
  cp "target/${target}/release/earpop-capture" "vendor/${out_name}"
  chmod +x "vendor/${out_name}"
  echo "Wrote vendor/${out_name}"
}

case "$MODE" in
  host)
    cargo build --release -p earpop-capture
    arch="$(uname -m)"
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "Host build OK (non-macOS). Vendor copy is macOS-only; skip."
      exit 0
    fi
    if [[ "$arch" == "arm64" ]]; then
      cp target/release/earpop-capture vendor/earpop-capture-darwin-arm64
      chmod +x vendor/earpop-capture-darwin-arm64
      echo "Wrote vendor/earpop-capture-darwin-arm64"
    else
      cp target/release/earpop-capture vendor/earpop-capture-darwin-x64
      chmod +x vendor/earpop-capture-darwin-x64
      echo "Wrote vendor/earpop-capture-darwin-x64"
    fi
    ;;
  mac)
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "capture:build:mac must run on macOS" >&2
      exit 1
    fi
    build_one aarch64-apple-darwin earpop-capture-darwin-arm64
    build_one x86_64-apple-darwin earpop-capture-darwin-x64
    ;;
  *)
    echo "Usage: $0 [host|mac]" >&2
    exit 1
    ;;
esac
