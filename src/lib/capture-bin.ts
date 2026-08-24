import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAPTURE_MISSING =
  "Microphone capture helper is missing. Run `pnpm capture:build` (dev) or reinstall earpop-cli.";

const PLATFORM_UNSUPPORTED =
  "Live microphone capture requires macOS, Windows, or Linux. Listing and exporting transcripts still work on this platform.";

function looksLikePackageRoot(dir: string) {
  if (existsSync(join(dir, "Cargo.toml")) && existsSync(join(dir, "crates"))) {
    return true;
  }
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name === "earpop-cli";
  } catch {
    return false;
  }
}

function packageRoot() {
  // tsx loads src/lib/; tsup bundles to dist/; npm installs both next to vendor/.
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!looksLikePackageRoot(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

function releaseBinName() {
  return process.platform === "win32" ? "earpop-capture.exe" : "earpop-capture";
}

function vendorName() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "earpop-capture-darwin-arm64";
    if (process.arch === "x64") return "earpop-capture-darwin-x64";
    return null;
  }
  if (process.platform === "win32") {
    if (process.arch === "x64") return "earpop-capture-win32-x64.exe";
    if (process.arch === "arm64") return "earpop-capture-win32-arm64.exe";
    return null;
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") return "earpop-capture-linux-x64";
    if (process.arch === "arm64") return "earpop-capture-linux-arm64";
    return null;
  }
  return null;
}

/** Absolute path to the capture sidecar, or a user-facing error string. */
export function resolveCaptureBin() {
  const fromEnv = process.env.EARPOP_CAPTURE_BIN?.trim();
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      return { ok: false as const, message: `EARPOP_CAPTURE_BIN not found: ${fromEnv}` };
    }
    return { ok: true as const, path: fromEnv };
  }

  const root = packageRoot();
  const release = join(root, "target", "release", releaseBinName());
  if (existsSync(release)) {
    return { ok: true as const, path: release };
  }

  const name = vendorName();
  if (name === null) {
    return { ok: false as const, message: PLATFORM_UNSUPPORTED };
  }

  const vendor = join(root, "vendor", name);
  if (existsSync(vendor)) {
    return { ok: true as const, path: vendor };
  }

  return { ok: false as const, message: CAPTURE_MISSING };
}
