#!/usr/bin/env bash
# Build earpop-capture into vendor/ for npm packaging.
# Modes: host | mac | win | linux | release
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-host}"
RUST_LINUX_IMAGE="${EARPOP_RUST_LINUX_IMAGE:-rust:bookworm}"

mkdir -p vendor
chmod +x "$ROOT/scripts/docker-build-linux.sh"

os_name() {
  uname -s 2>/dev/null || echo unknown
}

is_darwin() {
  [[ "$(os_name)" == "Darwin" ]]
}

is_linux() {
  [[ "$(os_name)" == "Linux" ]]
}

is_windows_shell() {
  case "$(os_name)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to build Linux vendor binaries from this host." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "docker daemon is not running." >&2
    exit 1
  fi
}

build_darwin() {
  local target="$1"
  local out_name="$2"
  echo "Building $out_name ($target)..."
  rustup target add "$target" >/dev/null 2>&1 || true
  cargo build --release -p earpop-capture --target "$target"
  cp "target/${target}/release/earpop-capture" "vendor/${out_name}"
  chmod +x "vendor/${out_name}"
  echo "Wrote vendor/${out_name}"
}

build_windows_x64() {
  local out_name="earpop-capture-win32-x64.exe"
  echo "Building $out_name (x86_64-pc-windows-msvc)..."
  rustup target add x86_64-pc-windows-msvc >/dev/null 2>&1 || true

  if is_windows_shell; then
    cargo build --release -p earpop-capture --target x86_64-pc-windows-msvc
  else
    if ! command -v cargo-xwin >/dev/null 2>&1; then
      echo "cargo-xwin is required to cross-build Windows from this host." >&2
      echo "Install: cargo install cargo-xwin" >&2
      exit 1
    fi
    cargo xwin build --release -p earpop-capture --target x86_64-pc-windows-msvc
  fi

  cp "target/x86_64-pc-windows-msvc/release/earpop-capture.exe" "vendor/${out_name}"
  echo "Wrote vendor/${out_name}"
}

docker_build_linux() {
  local platform="$1"
  local out_name="$2"
  echo "Building $out_name via Docker ($platform, $RUST_LINUX_IMAGE)..."
  require_docker
  docker run --rm --platform "$platform" \
    -v "$ROOT":/app -w /app \
    --entrypoint bash \
    "$RUST_LINUX_IMAGE" \
    /app/scripts/docker-build-linux.sh "$out_name"
  echo "Wrote vendor/${out_name}"
}

build_linux_x64() {
  if is_linux && [[ "$(uname -m)" == "x86_64" ]]; then
    echo "Building earpop-capture-linux-x64 (native)..."
    cargo build --release -p earpop-capture
    cp target/release/earpop-capture vendor/earpop-capture-linux-x64
    chmod +x vendor/earpop-capture-linux-x64
    echo "Wrote vendor/earpop-capture-linux-x64"
    return
  fi
  docker_build_linux linux/amd64 earpop-capture-linux-x64
}

build_linux_arm64() {
  if is_linux && [[ "$(uname -m)" == "aarch64" ]]; then
    echo "Building earpop-capture-linux-arm64 (native)..."
    cargo build --release -p earpop-capture
    cp target/release/earpop-capture vendor/earpop-capture-linux-arm64
    chmod +x vendor/earpop-capture-linux-arm64
    echo "Wrote vendor/earpop-capture-linux-arm64"
    return
  fi
  docker_build_linux linux/arm64 earpop-capture-linux-arm64
}

case "$MODE" in
  host)
    cargo build --release -p earpop-capture
    if is_darwin; then
      arch="$(uname -m)"
      if [[ "$arch" == "arm64" ]]; then
        cp target/release/earpop-capture vendor/earpop-capture-darwin-arm64
        chmod +x vendor/earpop-capture-darwin-arm64
        echo "Wrote vendor/earpop-capture-darwin-arm64"
      else
        cp target/release/earpop-capture vendor/earpop-capture-darwin-x64
        chmod +x vendor/earpop-capture-darwin-x64
        echo "Wrote vendor/earpop-capture-darwin-x64"
      fi
    elif is_windows_shell; then
      if [[ ! -f target/release/earpop-capture.exe ]]; then
        echo "expected target/release/earpop-capture.exe after host build" >&2
        exit 1
      fi
      cp target/release/earpop-capture.exe vendor/earpop-capture-win32-x64.exe
      echo "Wrote vendor/earpop-capture-win32-x64.exe"
    elif is_linux; then
      arch="$(uname -m)"
      if [[ "$arch" == "x86_64" ]]; then
        cp target/release/earpop-capture vendor/earpop-capture-linux-x64
        chmod +x vendor/earpop-capture-linux-x64
        echo "Wrote vendor/earpop-capture-linux-x64"
      elif [[ "$arch" == "aarch64" ]]; then
        cp target/release/earpop-capture vendor/earpop-capture-linux-arm64
        chmod +x vendor/earpop-capture-linux-arm64
        echo "Wrote vendor/earpop-capture-linux-arm64"
      else
        echo "Host Linux arch $arch is not mapped to a vendor binary." >&2
        exit 1
      fi
    else
      echo "Host build OK. Vendor copy for this OS is not configured; skip."
    fi
    ;;
  mac)
    if ! is_darwin; then
      echo "capture:build:mac must run on macOS" >&2
      exit 1
    fi
    build_darwin aarch64-apple-darwin earpop-capture-darwin-arm64
    build_darwin x86_64-apple-darwin earpop-capture-darwin-x64
    ;;
  win)
    build_windows_x64
    ;;
  linux)
    build_linux_x64
    build_linux_arm64
    ;;
  release)
    # Full cross set. Prefer macOS host (Darwin + cargo-xwin + Docker).
    if is_darwin; then
      build_darwin aarch64-apple-darwin earpop-capture-darwin-arm64
      build_darwin x86_64-apple-darwin earpop-capture-darwin-x64
      build_windows_x64
      build_linux_x64
      build_linux_arm64
    elif is_windows_shell; then
      build_windows_x64
      build_linux_x64
      build_linux_arm64
      echo "Note: macOS vendor binaries were not built (not on Darwin)." >&2
    elif is_linux; then
      build_linux_x64
      build_linux_arm64
      build_windows_x64
      echo "Note: macOS vendor binaries were not built (not on Darwin)." >&2
    else
      echo "capture:build:release expects macOS, Windows, or Linux" >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 [host|mac|win|linux|release]" >&2
    exit 1
    ;;
esac
