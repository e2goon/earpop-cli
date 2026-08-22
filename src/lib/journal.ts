import { existsSync } from "node:fs";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Journal, Token } from "#/lib/types.js";

const TRANSCRIPTS_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "com.earpop.app",
  "transcripts",
);
const FALLBACK_TRANSCRIPTS_DIR = join(homedir(), ".earpop", "transcripts");

const MAX_COLLISIONS = 100;

export function transcriptsDir() {
  return process.platform === "darwin" ? TRANSCRIPTS_DIR : FALLBACK_TRANSCRIPTS_DIR;
}

function isoWithOffset(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRest = pad(Math.abs(offsetMinutes) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${offsetHours}:${offsetRest}`
  );
}

function stampOf(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function openJournal(model: string) {
  const dir = transcriptsDir();

  const now = new Date();
  const stamp = stampOf(now);

  let id = stamp;
  for (let collision = 1; collision <= MAX_COLLISIONS; collision += 1) {
    if (!existsSync(join(dir, `${id}.jsonl`))) break;
    id = `${stamp}-${collision}`;
  }
  if (existsSync(join(dir, `${id}.jsonl`))) {
    id = `${stamp}-${now.getTime()}`;
  }
  const path = join(dir, `${id}.jsonl`);

  return new FileJournal({
    dir,
    id,
    path,
    model,
    startedAtIso: isoWithOffset(now),
  });
}

// Sync writes: close() is void and the process may exit immediately, so an async queue can drop the last line.
class FileJournal implements Journal {
  public readonly id: string;
  public readonly path: string;

  private readonly dir: string;
  private readonly model: string;
  private readonly startedAtIso: string;

  private readonly startedAtMs = Date.now();
  private handle: number | null = null;
  private closed = false;

  private sessionOffsetMs = 0;

  private warnedWriteFailure = false;

  public constructor({
    dir,
    id,
    path,
    model,
    startedAtIso,
  }: {
    dir: string;
    id: string;
    path: string;
    model: string;
    startedAtIso: string;
  }) {
    this.dir = dir;
    this.id = id;
    this.path = path;
    this.model = model;
    this.startedAtIso = startedAtIso;
  }

  public session(device: string) {
    this.sessionOffsetMs = Date.now() - this.startedAtMs;
    this.writeLine({
      line: JSON.stringify({ kind: "session", at_ms: this.sessionOffsetMs, device }),
      kind: "session",
    });
  }

  public tokens(tokens: Token[]) {
    for (const token of tokens) {
      // Missing end_ms must fall back to atMs (not 0) or the reader timeline inverts.
      const fallbackMs = Date.now() - this.startedAtMs;
      const atMs = token.startMs !== undefined ? this.sessionOffsetMs + token.startMs : fallbackMs;
      const endMs = token.endMs !== undefined ? this.sessionOffsetMs + token.endMs : atMs;

      const entry: Record<string, unknown> = {
        kind: "token",
        at_ms: atMs,
        end_ms: endMs,
        text: token.text,
      };
      if (token.speaker !== undefined) entry.speaker = token.speaker;
      if (token.language !== undefined) entry.language = token.language;

      this.writeLine({ line: JSON.stringify(entry), kind: "token" });
    }
  }

  public close() {
    if (this.closed) return;
    this.closed = true;
    this.writeLine({
      line: JSON.stringify({ kind: "ended", at_ms: Date.now() - this.startedAtMs }),
      kind: "ended",
    });
    if (this.handle !== null) {
      try {
        closeSync(this.handle);
      } catch {}
      this.handle = null;
    }
  }

  private writeLine({ line, kind }: { line: string; kind?: string }) {
    if (this.closed && kind !== "ended") return;

    try {
      if (this.handle === null) {
        mkdirSync(this.dir, { recursive: true });
        this.handle = openSync(this.path, "a");
        appendFileSync(
          this.handle,
          JSON.stringify({
            kind: "meeting",
            started_at: this.startedAtIso,
            model: this.model,
          }) + "\n",
        );
      }
      appendFileSync(this.handle, line + "\n");
    } catch (error) {
      if (!this.warnedWriteFailure) {
        this.warnedWriteFailure = true;
        console.error(`Failed to write meeting transcript: ${String(error)}`);
      }
    }
  }
}
