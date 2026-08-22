export interface Token {
  text: string;
  isFinal: boolean;
  speaker?: string;
  startMs?: number;
  endMs?: number;
  language?: string;
}

export type SttState = "connecting" | "listening" | "paused" | "stopped" | "error";

export type SttEvent =
  | { type: "state"; state: SttState; message?: string; retryable?: boolean }
  | { type: "tokens"; final: Token[]; pending: Token[] }
  | { type: "finished" };

export interface SttSession {
  sendAudio(frame: Buffer): void;
  stop(): Promise<void>;
}

export interface SttOptions {
  apiKey: string;
  model?: string;
  region?: SttRegion;
  clientReferenceId?: string;
  onEvent: (event: SttEvent) => void;
}

export type SttRegion = "us" | "eu" | "jp";

export interface Microphone {
  name: string;
  isDefault: boolean;
}

export interface AudioCapture {
  device: string;
  stop(): Promise<void>;
}

export interface AudioOptions {
  device?: string;
  onFrame: (frame: Buffer) => void;
  onError: (message: string) => void;
}

export interface Journal {
  id: string;
  path: string;
  session(device: string): void;
  tokens(tokens: Token[]): void;
  close(): void;
}

export interface CliSettings {
  microphone?: string;
  region?: SttRegion;
}
