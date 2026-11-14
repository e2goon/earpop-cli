import { open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { transcriptPath, transcriptsDir } from "#/lib/journal.js";
import { formatStamp } from "#/lib/transcript-formats.js";
import type { Token } from "#/lib/types.js";

interface TranscriptSummary {
  id: string;
  startedAt: string;
  duration: string;
}

export type TranscriptToken = Token & { atMs: number };

export interface Transcript {
  startedAt: string;
  model: string;
  tokens: TranscriptToken[];
}

interface ParsedLine {
  kind?: string;
  at_ms?: unknown;
  end_ms?: unknown;
  text?: unknown;
  speaker?: unknown;
  language?: unknown;
  translation?: unknown;
  source_language?: unknown;
  started_at?: unknown;
  model?: unknown;
}

function assertValidId(id: string) {
  if (!/^[\w][\w.-]*$/.test(id)) {
    throw new Error(`Invalid transcript ID: ${id}`);
  }
}

function parseLine(raw: string) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const value = JSON.parse(trimmed) as ParsedLine;
    if (typeof value !== "object" || value === null || typeof value.kind !== "string") {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function readLines(id: string) {
  const content = await readFile(transcriptPath(id), "utf8");
  return content
    .split("\n")
    .map(parseLine)
    .filter((line): line is ParsedLine => line !== null);
}

// Listing reads only the meeting header and the last lines, so long transcripts stay cheap.
const EDGE_BYTES = 4_096;

async function readEdges(path: string) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, EDGE_BYTES));
    await handle.read(head, 0, head.length, 0);
    const tailStart = Math.max(0, size - EDGE_BYTES);
    const tail = Buffer.alloc(size - tailStart);
    await handle.read(tail, 0, tail.length, tailStart);
    const tailLines = tail.toString("utf8").split("\n");
    // The first tail line may start mid-record.
    if (tailStart > 0) tailLines.shift();
    return { head: head.toString("utf8").split("\n", 1)[0] ?? "", tailLines };
  } finally {
    await handle.close();
  }
}

async function transcriptFiles() {
  let names: string[];
  try {
    names = await readdir(transcriptsDir());
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({ id: name.slice(0, -".jsonl".length), path: join(transcriptsDir(), name) }));
}

export async function listTranscripts() {
  const results = await Promise.all(
    (await transcriptFiles()).map(async ({ id, path }): Promise<TranscriptSummary | null> => {
      try {
        const { head, tailLines } = await readEdges(path);
        const meeting = parseLine(head);
        let lastAtMs = 0;
        for (const line of tailLines.map(parseLine)) {
          if (typeof line?.at_ms === "number") lastAtMs = Math.max(lastAtMs, line.at_ms);
          if (typeof line?.end_ms === "number") lastAtMs = Math.max(lastAtMs, line.end_ms);
        }
        return {
          id,
          startedAt:
            meeting?.kind === "meeting" && typeof meeting.started_at === "string"
              ? meeting.started_at
              : "(no timestamp)",
          duration: formatStamp(lastAtMs),
        };
      } catch {
        return null;
      }
    }),
  );
  const summaries = results.filter((summary) => summary !== null);
  summaries.sort((a, b) => b.id.localeCompare(a.id));
  return summaries;
}

export async function readTranscript(id: string) {
  assertValidId(id);
  const lines = await readLines(id);
  const meeting = lines.find((line) => line.kind === "meeting");

  const tokens: TranscriptToken[] = [];
  for (const line of lines) {
    if (line.kind !== "token") continue;
    if (typeof line.text !== "string" || typeof line.at_ms !== "number") continue;
    const token: TranscriptToken = { text: line.text, isFinal: true, atMs: line.at_ms };
    if (typeof line.speaker === "string") token.speaker = line.speaker;
    if (typeof line.language === "string") token.language = line.language;
    if (typeof line.end_ms === "number") token.endMs = line.end_ms;
    if (line.translation === true) {
      token.translation = true;
      if (typeof line.source_language === "string") token.sourceLanguage = line.source_language;
    }
    tokens.push(token);
  }

  return {
    startedAt: typeof meeting?.started_at === "string" ? meeting.started_at : "",
    model: typeof meeting?.model === "string" ? meeting.model : "",
    tokens,
  } satisfies Transcript;
}

/** Resolves `latest` to the newest transcript ID; IDs are start times, so the largest is newest. */
export async function resolveTranscriptId(id: string) {
  if (id !== "latest") return id;
  const newest = (await transcriptFiles())
    .map((file) => file.id)
    .sort()
    .at(-1);
  if (newest === undefined) throw new Error("No saved transcripts.");
  return newest;
}
