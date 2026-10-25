import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export const platforms = readJson(join(ROOT, "src/lib/capture-platforms.json"));

export function hostPlatform() {
  return platforms.find((p) => p.os === process.platform && p.cpu === process.arch);
}

export function runInherit({ command, args, cwd = ROOT }) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return r.status ?? 1;
}

export function runOrExit({ command, args }) {
  const status = runInherit({ command, args });
  if (status !== 0) process.exit(status);
}
