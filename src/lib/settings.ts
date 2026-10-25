import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeLanguageHints } from "#/lib/languages.js";
import { appDataDir } from "#/lib/paths.js";
import { isRegion } from "#/lib/region.js";
import { createSerialQueue } from "#/lib/serial-queue.js";
import type { CliSettings } from "#/lib/types";

// Serialize concurrent saves so writers do not clobber each other.
const enqueueWrite = createSerialQueue();

function settingsPath() {
  return join(appDataDir(), "cli-settings.json");
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
    if (isRegion(parsed.region)) settings.region = parsed.region;
    if (Array.isArray(parsed.languages))
      settings.languages = normalizeLanguageHints(parsed.languages);
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
  if (patch.languages !== undefined) {
    merged.languages = normalizeLanguageHints(patch.languages);
  }

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
  return enqueueWrite(() => writeThrough(patch));
}
