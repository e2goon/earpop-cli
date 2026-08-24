import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAPTURE_MISSING =
  "Microphone capture helper is missing. Run `pnpm capture:build` (dev) or reinstall earpop-cli.";

const PLATFORM_UNSUPPORTED =
  "Live microphone capture requires macOS, Windows, or Linux. Listing and exporting transcripts still work on this platform.";

/** Platform package + binary name for the current Node runtime. */
function platformCapture() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return { package: "earpop-capture-darwin-arm64", bin: "earpop-capture" };
    }
    if (process.arch === "x64") {
      return { package: "earpop-capture-darwin-x64", bin: "earpop-capture" };
    }
    return null;
  }
  if (process.platform === "win32") {
    if (process.arch === "x64") {
      return { package: "earpop-capture-win32-x64", bin: "earpop-capture.exe" };
    }
    return null;
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") {
      return { package: "earpop-capture-linux-x64", bin: "earpop-capture" };
    }
    if (process.arch === "arm64") {
      return { package: "earpop-capture-linux-arm64", bin: "earpop-capture" };
    }
    return null;
  }
  return null;
}

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

function resolveOptionalPackageBin({ package: pkgName, bin }: { package: string; bin: string }) {
  try {
    // Resolve from package root so tsx (src/) and tsup (dist/) both work.
    const require = createRequire(join(packageRoot(), "package.json"));
    const pkgJson = require.resolve(`${pkgName}/package.json`);
    const path = join(dirname(pkgJson), "bin", bin);
    if (existsSync(path)) return path;
  } catch {
    // optionalDependency not installed for this platform / ignored
  }
  return null;
}

function resolveWorkspaceBin({ package: pkgName, bin }: { package: string; bin: string }) {
  const path = join(packageRoot(), "npm", pkgName, "bin", bin);
  return existsSync(path) ? path : null;
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

  const platform = platformCapture();
  if (platform === null) {
    return { ok: false as const, message: PLATFORM_UNSUPPORTED };
  }

  const fromOptional = resolveOptionalPackageBin(platform);
  if (fromOptional) {
    return { ok: true as const, path: fromOptional };
  }

  const fromWorkspace = resolveWorkspaceBin(platform);
  if (fromWorkspace) {
    return { ok: true as const, path: fromWorkspace };
  }

  return { ok: false as const, message: CAPTURE_MISSING };
}
