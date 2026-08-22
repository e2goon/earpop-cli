import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CliSettings } from "#/lib/types";

// Serialize concurrent saves so writers do not clobber each other.
let writeChain: Promise<void> = Promise.resolve();

function settingsPath() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "com.earpop.app", "cli-settings.json");
  }
  return join(homedir(), ".earpop", "cli-settings.json");
}

export async function loadSettings() {
  let raw: string;
  try {
    raw = await readFile(settingsPath(), "utf8");
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CliSettings>;
    const settings: CliSettings = {};
    if (typeof parsed.microphone === "string") settings.microphone = parsed.microphone;
    if (parsed.region === "us" || parsed.region === "eu" || parsed.region === "jp") {
      settings.region = parsed.region;
    }
    return settings;
  } catch {
    return {};
  }
}

async function writeThrough(patch: Partial<CliSettings>) {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });

  const current = await loadSettings();
  const merged = { ...current, ...patch };

  const tempPath = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tempPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export function saveSettings(patch: Partial<CliSettings>) {
  const run = writeChain.then(() => writeThrough(patch));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
