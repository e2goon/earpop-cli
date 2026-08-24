import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import platforms from "#/lib/capture-platforms.json";
import integrity from "#/lib/capture-integrity.json";

const CAPTURE_MISSING =
  "Microphone capture helper is missing. Run `pnpm capture:build` (dev) or reinstall earpop-cli.";

const PLATFORM_UNSUPPORTED =
  "Live microphone capture requires macOS, Windows, or Linux. Listing and exporting transcripts still work on this platform.";

type CapturePlatform = (typeof platforms)[number];
type IntegrityMap = Record<string, string>;

function platformCapture(): CapturePlatform | null {
  return platforms.find((p) => p.os === process.platform && p.cpu === process.arch) ?? null;
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

function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyIntegrity({ package: pkgName, path }: { package: string; path: string }) {
  if (process.env.EARPOP_SKIP_CAPTURE_INTEGRITY === "1") {
    return { ok: true as const };
  }
  const expected = (integrity as IntegrityMap)[pkgName];
  if (expected === undefined || expected.length === 0) {
    // Empty map in-repo until the first publish fills hashes.
    return { ok: true as const };
  }
  const actual = sha256File(path);
  if (actual !== expected) {
    return {
      ok: false as const,
      message: `Capture helper integrity check failed for ${pkgName}. Reinstall earpop-cli or set EARPOP_SKIP_CAPTURE_INTEGRITY=1 only for local builds.`,
    };
  }
  return { ok: true as const };
}

function resolveOptionalPackageBin({ package: pkgName, bin }: CapturePlatform) {
  try {
    const require = createRequire(join(packageRoot(), "package.json"));
    const pkgJson = require.resolve(`${pkgName}/package.json`);
    const path = join(dirname(pkgJson), "bin", bin);
    if (existsSync(path)) return path;
  } catch {
    // optionalDependency not installed for this platform / ignored
  }
  return null;
}

function resolveWorkspaceBin({ package: pkgName, bin }: CapturePlatform) {
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
    // Dev override — skip release integrity map.
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
    const check = verifyIntegrity({ package: platform.package, path: fromOptional });
    if (!check.ok) return check;
    return { ok: true as const, path: fromOptional };
  }

  const fromWorkspace = resolveWorkspaceBin(platform);
  if (fromWorkspace) {
    const check = verifyIntegrity({ package: platform.package, path: fromWorkspace });
    if (!check.ok) return check;
    return { ok: true as const, path: fromWorkspace };
  }

  return { ok: false as const, message: CAPTURE_MISSING };
}
