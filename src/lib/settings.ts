import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeLanguageHints, normalizeTranslation } from "#/lib/languages.js";
import { appDataDir } from "#/lib/paths.js";
import { isRegion } from "#/lib/region.js";
import { createSerialQueue } from "#/lib/serial-queue.js";
import type { CliSettings } from "#/lib/types.js";

// Soniox caps the whole context near 10,000 characters; leave room for the transcript tail
// and language notes that every session also sends.
export const MAX_TERMS_CHARS = 6_000;

/** Trims, drops empty and duplicate entries, and keeps the first spelling of each term. */
export function normalizeTerms(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const term = item.trim().replace(/\s+/g, " ");
    if (term === "" || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

export function termsSize(terms: string[]) {
  return terms.reduce((total, term) => total + term.length, 0);
}

/** The leading terms that fit the limit; a hand-edited file can hold more than `terms add` allows. */
export function fitTerms(terms: string[]) {
  let size = 0;
  return terms.filter((term) => (size += term.length) <= MAX_TERMS_CHARS);
}

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
    const terms = normalizeTerms(parsed.terms);
    if (terms.length > 0) settings.terms = terms;
    const translation = normalizeTranslation(parsed.translation);
    if (translation.length > 0) settings.translation = translation;
    return settings;
  } catch {
    return {};
  }
}

async function writeThrough(patch: Partial<CliSettings>) {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const current = await loadSettings();
  const merged = { ...current, ...patch };
  if (patch.languages !== undefined) {
    merged.languages = normalizeLanguageHints(patch.languages);
  }
  if (patch.terms !== undefined) {
    const terms = normalizeTerms(patch.terms);
    if (terms.length > 0) merged.terms = terms;
    else delete merged.terms;
  }
  if (patch.translation !== undefined) {
    const translation = normalizeTranslation(patch.translation);
    if (translation.length > 0) merged.translation = translation;
    else delete merged.translation;
  }

  const tempPath = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tempPath, JSON.stringify(merged, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export function saveSettings(patch: Partial<CliSettings>) {
  return enqueueWrite(() => writeThrough(patch));
}
