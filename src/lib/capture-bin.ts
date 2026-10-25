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
type CaptureBin = { ok: true; path: string } | { ok: false; message: string };

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

function integrityFailure({ package: pkgName, path }: { package: string; path: string }) {
  if (process.env.EARPOP_SKIP_CAPTURE_INTEGRITY === "1") return null;
  const expected = (integrity as IntegrityMap)[pkgName];
  // Empty map in-repo until the first publish fills hashes.
  if (expected === undefined || expected.length === 0) return null;
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual === expected) return null;
  return `Capture helper integrity check failed for ${pkgName}. Reinstall earpop-cli or set EARPOP_SKIP_CAPTURE_INTEGRITY=1 only for local builds.`;
}

function resolveOptionalPackageBin({
  root,
  platform: { package: pkgName, bin },
}: {
  root: string;
  platform: CapturePlatform;
}) {
  try {
    const require = createRequire(join(root, "package.json"));
    const pkgJson = require.resolve(`${pkgName}/package.json`);
    const path = join(dirname(pkgJson), "bin", bin);
    if (existsSync(path)) return path;
  } catch {
    // optionalDependency not installed for this platform / ignored
  }
  return null;
}

function resolveWorkspaceBin({
  root,
  platform: { package: pkgName, bin },
}: {
  root: string;
  platform: CapturePlatform;
}) {
  const path = join(root, "npm", pkgName, "bin", bin);
  return existsSync(path) ? path : null;
}

function resolveUncached(): CaptureBin {
  const fromEnv = process.env.EARPOP_CAPTURE_BIN?.trim();
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      return { ok: false, message: `EARPOP_CAPTURE_BIN not found: ${fromEnv}` };
    }
    // Dev override — skip release integrity map.
    return { ok: true, path: fromEnv };
  }

  const root = packageRoot();
  const release = join(
    root,
    "target",
    "release",
    process.platform === "win32" ? "earpop-capture.exe" : "earpop-capture",
  );
  if (existsSync(release)) {
    return { ok: true, path: release };
  }

  const platform = platforms.find((p) => p.os === process.platform && p.cpu === process.arch);
  if (platform === undefined) {
    return { ok: false, message: PLATFORM_UNSUPPORTED };
  }

  const found =
    resolveOptionalPackageBin({ root, platform }) ?? resolveWorkspaceBin({ root, platform });
  if (found === null) {
    return { ok: false, message: CAPTURE_MISSING };
  }
  const failure = integrityFailure({ package: platform.package, path: found });
  return failure === null ? { ok: true, path: found } : { ok: false, message: failure };
}

let found: CaptureBin | null = null;

/** Absolute path to the capture sidecar, or a user-facing error string. */
export function resolveCaptureBin() {
  if (found !== null) return found;
  const result = resolveUncached();
  if (result.ok) found = result;
  return result;
}
