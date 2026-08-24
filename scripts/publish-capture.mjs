#!/usr/bin/env node
/**
 * Publish platform capture packages, then earpop-cli.
 * Expects binaries under npm/<package>/bin/. Prefer CI on tag v* (see capture.yml).
 *
 *   node scripts/publish-capture.mjs           # dry-run (this host)
 *   node scripts/publish-capture.mjs --all     # dry-run (all platforms)
 *   node scripts/publish-capture.mjs --publish # write integrity, publish (CI)
 *
 * Root build uses package.json prepublishOnly (tsup). GITHUB_ACTIONS → npm --provenance.
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

function run(command, args, cwd = ROOT) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${r.status ?? 1})`);
  }
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

const integrity = {};
for (const p of needed) {
  const binPath = join(ROOT, "npm", p.package, "bin", p.bin);
  if (!existsSync(binPath)) {
    console.error(`Missing binary: ${binPath}`);
    process.exit(1);
  }
  integrity[p.package] = sha256File(binPath);
  console.log(`OK ${p.package}/bin/${p.bin} sha256=${integrity[p.package].slice(0, 12)}…`);
}

console.log(`Version ${version}; checked ${needed.length} package(s).`);

if (!doPublish) {
  console.log(requireAll ? "Dry run (all) OK." : "Dry run (host) OK.");
  process.exit(0);
}

writeJson(INTEGRITY_PATH, integrity);
console.log(`Wrote ${INTEGRITY_PATH}`);

for (const p of platforms) {
  const pkgPath = join(ROOT, "npm", p.package, "package.json");
  const pkg = readJson(pkgPath);
  pkg.version = version;
  pkg.repository = {
    type: "git",
    url: "https://github.com/e2goon/earpop-cli.git",
  };
  writeJson(pkgPath, pkg);
}

rootPkg.repository = {
  type: "git",
  url: "https://github.com/e2goon/earpop-cli.git",
};
const exactOptional = {};
for (const p of platforms) {
  exactOptional[p.package] = version;
}
rootPkg.optionalDependencies = exactOptional;
writeJson(rootPkgPath, rootPkg);

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
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  restoreOptional(rootPkg, savedOptional);
  console.log("Restored root optionalDependencies to workspace:*.");
}
