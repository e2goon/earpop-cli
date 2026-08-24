#!/usr/bin/env bash
# Runs inside the Rust Linux container. Args: <vendor-out-name>
set -euo pipefail

export PATH="/usr/local/cargo/bin:${PATH:-}"

OUT_NAME="${1:?vendor output name required}"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libasound2-dev pkg-config >/dev/null

cargo build --release -p earpop-capture --target-dir /tmp/earpop-target
mkdir -p /app/vendor
cp /tmp/earpop-target/release/earpop-capture "/app/vendor/${OUT_NAME}"
chmod +x "/app/vendor/${OUT_NAME}"
file "/app/vendor/${OUT_NAME}"
