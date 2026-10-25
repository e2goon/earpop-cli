import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { appDataDir } from "#/lib/paths.js";
import type { Journal, Token } from "#/lib/types.js";

const MAX_COLLISIONS = 100;

export function transcriptsDir() {
  return join(appDataDir(), "transcripts");
}

export function transcriptPath(id: string) {
  return join(transcriptsDir(), `${id}.jsonl`);
}

const pad = (value: number) => String(value).padStart(2, "0");

function isoWithOffset(date: Date) {
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

export function openJournal(model: string) {
  const now = new Date();
  const startedAtIso = isoWithOffset(now);
  const stamp = startedAtIso.slice(0, 19).replace("T", "_").replaceAll(":", "-");

  let id = stamp;
  for (let collision = 1; collision <= MAX_COLLISIONS; collision += 1) {
    if (!existsSync(transcriptPath(id))) break;
    id = `${stamp}-${collision}`;
  }
  if (existsSync(transcriptPath(id))) {
    id = `${stamp}-${now.getTime()}`;
  }

  return new FileJournal({ id, model, startedAtIso });
}

// Sync writes: close() is void and the process may exit immediately, so an async queue can drop the last line.
class FileJournal implements Journal {
  public readonly id: string;
  public readonly path: string;

  private readonly model: string;
  private readonly startedAtIso: string;

  private readonly startedAtMs = Date.now();
  private handle: number | null = null;
  private closed = false;

  private sessionOffsetMs = 0;

  private warnedWriteFailure = false;

  public constructor({
    id,
    model,
    startedAtIso,
  }: {
    id: string;
    model: string;
    startedAtIso: string;
  }) {
    this.id = id;
    this.path = transcriptPath(id);
    this.model = model;
    this.startedAtIso = startedAtIso;
  }

  public session(device: string) {
    this.sessionOffsetMs = Date.now() - this.startedAtMs;
    this.write(JSON.stringify({ kind: "session", at_ms: this.sessionOffsetMs, device }) + "\n");
  }

  public tokens(tokens: Token[]) {
    // Missing end_ms must fall back to atMs (not 0) or the reader timeline inverts.
    const fallbackMs = Date.now() - this.startedAtMs;
    let lines = "";
    for (const token of tokens) {
      const atMs = token.startMs !== undefined ? this.sessionOffsetMs + token.startMs : fallbackMs;
      const endMs = token.endMs !== undefined ? this.sessionOffsetMs + token.endMs : atMs;
      lines +=
        JSON.stringify({
          kind: "token",
          at_ms: atMs,
          end_ms: endMs,
          text: token.text,
          speaker: token.speaker,
          language: token.language,
        }) + "\n";
    }
    this.write(lines);
  }

  public close() {
    if (this.closed) return;
    this.write(JSON.stringify({ kind: "ended", at_ms: Date.now() - this.startedAtMs }) + "\n");
    this.closed = true;
    if (this.handle !== null) {
      try {
        closeSync(this.handle);
      } catch {}
      this.handle = null;
    }
  }

  private write(lines: string) {
    if (this.closed || lines === "") return;

    try {
      if (this.handle === null) {
        mkdirSync(transcriptsDir(), { recursive: true });
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
      appendFileSync(this.handle, lines);
    } catch (error) {
      if (!this.warnedWriteFailure) {
        this.warnedWriteFailure = true;
        console.error(`Failed to write meeting transcript: ${String(error)}`);
      }
    }
  }
}
