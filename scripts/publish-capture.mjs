#!/usr/bin/env node
/**
 * Publish platform capture packages, then earpop-cli.
 * Expects binaries already staged under npm/<package>/bin/.
 * Preferred path: GitHub Actions on tag v* (.github/workflows/capture.yml).
 *
 * Dry-run (this host only): node scripts/publish-capture.mjs
 * Dry-run (all platforms):   node scripts/publish-capture.mjs --all
 * Publish:                   node scripts/publish-capture.mjs --publish
 *
 * On publish: writes SHA-256 map, syncs versions, runs tsup, publishes,
 * then restores root optionalDependencies to workspace:*.
 * Under GITHUB_ACTIONS, adds npm --provenance.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORMS_PATH = join(ROOT, "src/lib/capture-platforms.json");
const INTEGRITY_PATH = join(ROOT, "src/lib/capture-integrity.json");
const platforms = JSON.parse(readFileSync(PLATFORMS_PATH, "utf8"));
const doPublish = process.argv.includes("--publish");
const requireAll = doPublish || process.argv.includes("--all");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hostPlatform() {
  return platforms.find((p) => p.os === process.platform && p.cpu === process.arch);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function workspaceOptionalDeps() {
  const optional = {};
  for (const p of platforms) {
    optional[p.package] = "workspace:*";
  }
  return optional;
}

function restoreOptional(rootPkg, savedOptional) {
  rootPkg.optionalDependencies = savedOptional ?? workspaceOptionalDeps();
  writeJson(join(ROOT, "package.json"), rootPkg);
}

const rootPkgPath = join(ROOT, "package.json");
const rootPkg = readJson(rootPkgPath);
const version = rootPkg.version;
const savedOptional = structuredClone(rootPkg.optionalDependencies);

const needed = requireAll
  ? platforms
  : (() => {
      const host = hostPlatform();
      if (!host) {
        console.error(`No capture package for ${process.platform}-${process.arch}`);
        process.exit(1);
      }
      return [host];
    })();

for (const p of needed) {
  const binPath = join(ROOT, "npm", p.package, "bin", p.bin);
  if (!existsSync(binPath)) {
    console.error(`Missing binary: ${binPath}`);
    process.exit(1);
  }
  const hash = sha256File(binPath);
  console.log(`OK ${p.package}/bin/${p.bin} sha256=${hash.slice(0, 12)}…`);
}

console.log(`Version ${version}; checked ${needed.length} package(s).`);

if (!doPublish) {
  console.log(requireAll ? "Dry run (all) OK." : "Dry run (host) OK. Use --all before release.");
  process.exit(0);
}

const integrity = {};
for (const p of platforms) {
  const binPath = join(ROOT, "npm", p.package, "bin", p.bin);
  integrity[p.package] = sha256File(binPath);
}
writeJson(INTEGRITY_PATH, integrity);
console.log(`Wrote ${INTEGRITY_PATH}`);

for (const p of platforms) {
  const pkgPath = join(ROOT, "npm", p.package, "package.json");
  const pkg = readJson(pkgPath);
  pkg.version = version;
  writeJson(pkgPath, pkg);
}

const exactOptional = {};
for (const p of platforms) {
  exactOptional[p.package] = version;
}
rootPkg.optionalDependencies = exactOptional;
writeJson(rootPkgPath, rootPkg);

function run(command, args, cwd = ROOT) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    restoreOptional(rootPkg, savedOptional);
    process.exit(r.status ?? 1);
  }
}

run("pnpm", ["exec", "tsup"]);

const npmPublishArgs = ["publish", "--access", "public"];
if (process.env.GITHUB_ACTIONS === "true") {
  npmPublishArgs.push("--provenance");
}

try {
  for (const p of platforms) {
    console.log(`Publishing ${p.package}@${version}...`);
    run("npm", npmPublishArgs, join(ROOT, "npm", p.package));
  }
  console.log(`Publishing earpop-cli@${version}...`);
  run("npm", npmPublishArgs, ROOT);
} finally {
  restoreOptional(rootPkg, savedOptional);
  console.log("Restored root optionalDependencies to workspace:* (or previous values).");
}
