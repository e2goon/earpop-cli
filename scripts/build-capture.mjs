#!/usr/bin/env node
/**
 * Build earpop-capture for this host and stage into npm/<package>/bin/.
 * Cross-platform release binaries are produced by Depot CI (.depot/workflows/capture.yml).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const r = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("cargo", ["build", "--release", "-p", "earpop-capture"]);
run(process.execPath, [join(ROOT, "scripts/stage-capture.mjs"), "--host"]);
