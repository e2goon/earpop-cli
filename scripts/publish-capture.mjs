#!/usr/bin/env node
/**
 * Publish platform capture packages, then earpop-cli.
 * Expects binaries already staged under npm/<package>/bin/.
 *
 * Dry-run (this host only): node scripts/publish-capture.mjs
 * Dry-run (all platforms):   node scripts/publish-capture.mjs --all
 * Publish:                   node scripts/publish-capture.mjs --publish
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const platforms = JSON.parse(readFileSync(join(ROOT, "scripts/capture-platforms.json"), "utf8"));
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

const rootPkgPath = join(ROOT, "package.json");
const rootPkg = readJson(rootPkgPath);
const version = rootPkg.version;

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
  console.log(`OK ${p.package}/bin/${p.bin}`);
}

console.log(`Version ${version}; checked ${needed.length} package(s).`);

if (!doPublish) {
  console.log(requireAll ? "Dry run (all) OK." : "Dry run (host) OK. Use --all before release.");
  process.exit(0);
}

const optional = {};
for (const p of platforms) {
  optional[p.package] = version;
  const pkgPath = join(ROOT, "npm", p.package, "package.json");
  const pkg = readJson(pkgPath);
  pkg.version = version;
  writeJson(pkgPath, pkg);
}

rootPkg.optionalDependencies = optional;
writeJson(rootPkgPath, rootPkg);

function npmPublish(cwd) {
  const r = spawnSync("npm", ["publish", "--access", "public"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

for (const p of platforms) {
  console.log(`Publishing ${p.package}@${version}...`);
  npmPublish(join(ROOT, "npm", p.package));
}

console.log(`Publishing earpop-cli@${version}...`);
npmPublish(ROOT);
