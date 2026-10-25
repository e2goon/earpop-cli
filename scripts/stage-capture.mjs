#!/usr/bin/env node
/**
 * Stage a built earpop-capture binary into npm/<package>/bin/.
 *
 * node scripts/stage-capture.mjs --host
 * node scripts/stage-capture.mjs --package earpop-capture-darwin-arm64 [--from path]
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, hostPlatform, platforms } from "./lib.mjs";

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
const platform = args.host ? hostPlatform() : platforms.find((p) => p.package === args.pkg);
if (args.host && !platform) {
  throw new Error(`No capture package for ${process.platform}-${process.arch}`);
}

if (!platform) {
  console.error("Usage: stage-capture.mjs --host | --package <name> [--from path]");
  process.exit(1);
}

stage(platform, args.from ?? defaultFrom(platform));
