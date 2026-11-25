import type { SttLanguage } from "#/lib/languages.js";
import type { SttRegion } from "#/lib/region.js";

export type { SttRegion };

export interface Token {
  text: string;
  isFinal: boolean;
  speaker?: string;
  startMs?: number;
  endMs?: number;
  language?: string;
  /** Set on translated text; translations carry no timestamps. */
  translation?: boolean;
  /** Language the translation was made from. */
  sourceLanguage?: string;
}

export type SttState = "connecting" | "listening" | "paused" | "stopped" | "error";

export type SttEvent =
  | { type: "state"; state: SttState; message?: string; retryable?: boolean }
  | { type: "tokens"; final: Token[]; pending: Token[] };

export interface SttSession {
  sendAudio(frame: Buffer): void;
  stop(): Promise<void>;
}

export interface SttOptions {
  apiKey: string;
  region?: SttRegion;
  languageHints?: SttLanguage[];
  clientReferenceId?: string;
  /** Recent final transcript tail; biases recognition on reconnect. */
  contextText?: string;
  /** Words and names to spell as listed (Soniox context.terms). */
  terms?: string[];
  /** One language: translate everything into it. Two: translate between them. */
  translation?: SttLanguage[];
  onEvent: (event: SttEvent) => void;
}

export interface Microphone {
  name: string;
  isDefault: boolean;
}

export interface AudioCapture {
  device: string;
  stop(): Promise<void>;
}

export interface AudioOptions {
  device: string;
  onFrame: (frame: Buffer) => void;
  onError: (message: string) => void;
}

export interface Journal {
  id: string;
  path: string;
  readonly hasWritten: boolean;
  /** Records the device and returns the session start offset for token timestamps. */
  session(device: string): number;
  tokens(args: { tokens: Token[]; offsetMs: number }): void;
  close(): void;
  /** Set after the first failed write; the file is missing lines from then on. */
  readonly writeError?: string;
}

export interface CliSettings {
  microphone?: string;
  region?: SttRegion;
  languages?: SttLanguage[];
  terms?: string[];
  translation?: SttLanguage[];
}
