import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { transcriptsDir } from "#/lib/journal.js";
import type { Token } from "#/lib/types.js";

const PARAGRAPH_GAP_MS = 2_000;

export interface TranscriptSummary {
  id: string;
  startedAt: string;
  tokenCount: number;
}

type TranscriptToken = Token & { atMs: number };

interface Transcript {
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
  started_at?: unknown;
  model?: unknown;
}

function pathOf(id: string) {
  return join(transcriptsDir(), `${id}.jsonl`);
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
  const content = await readFile(pathOf(id), "utf8");
  return content
    .split("\n")
    .map(parseLine)
    .filter((line): line is ParsedLine => line !== null);
}

export async function listTranscripts() {
  const dir = transcriptsDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: TranscriptSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    try {
      const lines = await readLines(id);
      const meeting = lines.find((line) => line.kind === "meeting");
      summaries.push({
        id,
        startedAt: typeof meeting?.started_at === "string" ? meeting.started_at : "(no timestamp)",
        tokenCount: lines.filter((line) => line.kind === "token").length,
      });
    } catch {}
  }

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
    const token: TranscriptToken = { ...toTokenFields(line), atMs: line.at_ms };
    tokens.push(token);
  }

  return {
    startedAt: typeof meeting?.started_at === "string" ? meeting.started_at : "",
    model: typeof meeting?.model === "string" ? meeting.model : "",
    tokens,
  } satisfies Transcript;
}

function toTokenFields(line: ParsedLine) {
  const token: Token = { text: line.text as string, isFinal: true };
  if (typeof line.speaker === "string") token.speaker = line.speaker;
  if (typeof line.language === "string") token.language = line.language;
  if (typeof line.end_ms === "number") token.endMs = line.end_ms;
  return token;
}

function formatStamp(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const minutesTotal = Math.floor(totalSeconds / 60);
  if (minutesTotal >= 60) {
    const hh = Math.floor(minutesTotal / 60);
    return `${hh}:${String(minutesTotal % 60).padStart(2, "0")}:${ss}`;
  }
  return `${String(minutesTotal).padStart(2, "0")}:${ss}`;
}

export async function exportText(id: string) {
  assertValidId(id);
  const transcript = await readTranscript(id);

  interface Paragraph {
    startMs: number;
    lastAtMs: number;
    speaker?: string;
    text: string;
  }

  const paragraphs: Paragraph[] = [];
  for (const token of transcript.tokens) {
    if (token.text.trim() === "") continue;
    const previous = paragraphs.at(-1);

    const speakerChanged = previous !== undefined && token.speaker !== previous.speaker;
    const gapExceeded = previous !== undefined && token.atMs - previous.lastAtMs > PARAGRAPH_GAP_MS;

    if (previous === undefined || speakerChanged || gapExceeded) {
      paragraphs.push({
        startMs: token.atMs,
        lastAtMs: token.atMs,
        speaker: token.speaker,
        text: token.text,
      });
      continue;
    }
    previous.text += token.text;
    previous.lastAtMs = token.atMs;
  }

  const head: string[] = ["earpop transcript v1", `id: ${id}`];
  if (transcript.startedAt !== "") {
    head.push(`started: ${transcript.startedAt}`);
  }
  if (transcript.model !== "") {
    head.push(`model: ${transcript.model}`);
  }
  head.push("");

  const body = paragraphs.map((paragraph) => {
    const speakerTag = paragraph.speaker !== undefined ? `S${paragraph.speaker}` : "S?";
    return `[${formatStamp(paragraph.startMs)}] ${speakerTag}: ${paragraph.text.trim()}`;
  });

  return [...head, ...body].join("\n") + "\n";
}
