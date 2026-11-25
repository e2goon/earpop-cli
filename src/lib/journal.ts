import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#/lib/errors.js";
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

/** `onWriteError` fires once, on the first failed write; later failures stay silent. */
export function openJournal({
  model,
  onWriteError,
}: {
  model: string;
  onWriteError: (message: string) => void;
}) {
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

  return new FileJournal({ id, model, startedAtIso, onWriteError });
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

  public hasWritten = false;
  public writeError?: string;
  // Translations have no timestamps; they are filed at the end of the speech they follow.
  private lastSpokenEndMs = 0;

  private readonly onWriteError: (message: string) => void;

  public constructor({
    id,
    model,
    startedAtIso,
    onWriteError,
  }: {
    id: string;
    model: string;
    startedAtIso: string;
    onWriteError: (message: string) => void;
  }) {
    this.onWriteError = onWriteError;
    this.id = id;
    this.path = transcriptPath(id);
    this.model = model;
    this.startedAtIso = startedAtIso;
  }

  public session(device: string) {
    const atMs = Date.now() - this.startedAtMs;
    this.write(JSON.stringify({ kind: "session", at_ms: atMs, device }) + "\n");
    return atMs;
  }

  public tokens({ tokens, offsetMs }: { tokens: Token[]; offsetMs: number }) {
    // Missing end_ms must fall back to atMs (not 0) or the reader timeline inverts.
    const fallbackMs = Date.now() - this.startedAtMs;
    let lines = "";
    for (const token of tokens) {
      let atMs = this.lastSpokenEndMs;
      let endMs = atMs;
      if (token.translation !== true) {
        atMs = token.startMs !== undefined ? offsetMs + token.startMs : fallbackMs;
        endMs = token.endMs !== undefined ? offsetMs + token.endMs : atMs;
        this.lastSpokenEndMs = endMs;
      }
      // Undefined fields drop out of the JSON, so plain speech lines keep their old shape.
      lines +=
        JSON.stringify({
          kind: "token",
          at_ms: atMs,
          end_ms: endMs,
          text: token.text,
          speaker: token.speaker,
          language: token.language,
          translation: token.translation,
          source_language: token.sourceLanguage,
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
        mkdirSync(transcriptsDir(), { recursive: true, mode: 0o700 });
        this.handle = openSync(this.path, "a", 0o600);
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
      this.hasWritten = true;
    } catch (error) {
      if (this.writeError === undefined) {
        this.writeError = errorMessage(error);
        // The live screen owns the terminal, so report through the UI instead of stderr.
        this.onWriteError(`Transcript is not being saved: ${errorMessage(error)}`);
      }
    }
  }
}
