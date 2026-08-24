#!/usr/bin/env node
/**
 * Stage a built earpop-capture binary into npm/<package>/bin/.
 *
 * node scripts/stage-capture.mjs --host
 * node scripts/stage-capture.mjs --package earpop-capture-darwin-arm64 [--from path]
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const platforms = JSON.parse(
  readFileSync(join(ROOT, "src/lib/capture-platforms.json"), "utf8"),
);

function hostPlatform() {
  const os = process.platform;
  const cpu = process.arch;
  const hit = platforms.find((p) => p.os === os && p.cpu === cpu);
  if (!hit) {
    throw new Error(`No capture package for ${os}-${cpu}`);
  }
  return hit;
}

function parseArgs(argv) {
  let pkg = null;
  let from = null;
  let host = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") host = true;
    else if (a === "--package") pkg = argv[++i];
    else if (a === "--from") from = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return { pkg, from, host };
}

function defaultFrom(platform) {
  const releaseDir = join(ROOT, "target", "release");
  const targeted = join(ROOT, "target", platform.rustTarget, "release", platform.bin);
  if (existsSync(targeted)) return targeted;
  const hostBin = join(releaseDir, platform.bin);
  if (existsSync(hostBin)) return hostBin;
  throw new Error(`Built binary not found for ${platform.package} (looked in target/)`);
}

function stage(platform, fromPath) {
  const destDir = join(ROOT, "npm", platform.package, "bin");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, platform.bin);
  copyFileSync(fromPath, dest);
  if (platform.os !== "win32") chmodSync(dest, 0o755);
  console.log(`Staged ${fromPath} → npm/${platform.package}/bin/${platform.bin}`);
}

const args = parseArgs(process.argv.slice(2));
const platform = args.host
  ? hostPlatform()
  : platforms.find((p) => p.package === args.pkg);

if (!platform) {
  console.error("Usage: stage-capture.mjs --host | --package <name> [--from path]");
  process.exit(1);
}

stage(platform, args.from ?? defaultFrom(platform));
