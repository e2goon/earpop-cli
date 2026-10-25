import WebSocket from "ws";

import { languageGeneralContext, normalizeLanguageHints } from "#/lib/languages.js";
import { DEFAULT_REGION } from "#/lib/region.js";
import type { SttEvent, SttOptions, SttRegion, SttSession, Token } from "#/lib/types";

export const STT_MODEL = "stt-rt-v5";

/** Keep a short rolling transcript for Soniox context on reconnect (matches desktop). */
const STT_CONTEXT_CHARS = 1_500;

const CONNECT_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
// Server drops after 20s silence; keepalive at half that interval.
const KEEPALIVE_INTERVAL_MS = 10_000;
// ~5s of 16 kHz mono s16le; drop audio when backlog exceeds this.
const BACKLOG_LIMIT_BYTES = 160 * 1024;

export function appendSttContext({ text, tokens }: { text: string; tokens: Token[] }) {
  let next = text;
  for (const token of tokens) {
    next += token.text;
  }
  if (next.length <= STT_CONTEXT_CHARS) return next;
  const chars = [...next];
  if (chars.length > STT_CONTEXT_CHARS) {
    return chars.slice(-STT_CONTEXT_CHARS).join("");
  }
  return next;
}

interface ServerToken {
  text?: string;
  is_final?: boolean;
  speaker?: string;
  start_ms?: number;
  end_ms?: number;
  language?: string;
}

interface ServerResponse {
  tokens?: ServerToken[];
  finished?: boolean;
  error_code?: number | null;
  error_message?: string | null;
}

function toToken(raw: ServerToken) {
  const token: Token = { text: raw.text ?? "", isFinal: raw.is_final === true };
  if (raw.speaker !== undefined) token.speaker = String(raw.speaker);
  if (raw.start_ms !== undefined) token.startMs = raw.start_ms;
  if (raw.end_ms !== undefined) token.endMs = raw.end_ms;
  if (raw.language !== undefined) token.language = raw.language;
  return token;
}

const END_TOKEN_TEXT = "<end>";

const REGION_WEBSOCKET_URLS: Record<SttRegion, string> = {
  us: "wss://stt-rt.soniox.com/transcribe-websocket",
  eu: "wss://stt-rt.eu.soniox.com/transcribe-websocket",
  jp: "wss://stt-rt.jp.soniox.com/transcribe-websocket",
};

export function startSession({
  apiKey,
  region,
  languageHints,
  clientReferenceId,
  contextText,
  onEvent,
}: SttOptions) {
  const hints = normalizeLanguageHints(languageHints);
  return new Promise<SttSession>((resolve, reject) => {
    const socket = new WebSocket(REGION_WEBSOCKET_URLS[region ?? DEFAULT_REGION], {
      perMessageDeflate: false,
    });

    let settled = false;
    let stopped = false;
    let finishedSeen = false;
    let errored = false;
    let resolveStop: (() => void) | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    const clearKeepalive = () => {
      if (keepaliveTimer !== null) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    };

    const emit = (event: SttEvent) => {
      if (!stopped) onEvent(event);
    };
    const connectTimeout = setTimeout(() => {
      if (settled) return;
      settleReject(
        new Error("Could not connect to transcription server within 15s. Check your network"),
      );
      socket.terminate();
    }, CONNECT_TIMEOUT_MS);

    function settleReject(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      clearKeepalive();
      reject(error);
    }

    socket.on("open", () => {
      clearTimeout(connectTimeout);
      // Endpoint off: provisional streams fast; finals come later with better word/diarization accuracy.
      const config = {
        api_key: apiKey,
        model: STT_MODEL,
        audio_format: "pcm_s16le",
        sample_rate: 16000,
        num_channels: 1,
        language_hints: hints,
        // Strict is strongest with a single language; multiple hints stay a bias only.
        language_hints_strict: hints.length === 1,
        enable_speaker_diarization: true,
        enable_endpoint_detection: false,
        context: {
          general: languageGeneralContext(hints),
          text: contextText || undefined,
        },
        client_reference_id: clientReferenceId,
      };
      socket.send(JSON.stringify(config));

      keepaliveTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send('{"type":"keepalive"}');
        }
      }, KEEPALIVE_INTERVAL_MS);

      emit({ type: "state", state: "listening" });
      settled = true;
      resolve({
        sendAudio(frame: Buffer) {
          if (socket.readyState !== WebSocket.OPEN) return;
          // Drop lagged audio so live speech is not delayed behind the backlog.
          if (socket.bufferedAmount > BACKLOG_LIMIT_BYTES) return;
          socket.send(frame);
        },
        async stop() {
          if (finishedSeen || socket.readyState !== WebSocket.OPEN) {
            clearKeepalive();
            if (socket.readyState !== WebSocket.CLOSED) socket.close();
            return;
          }
          await new Promise<void>((done) => {
            const timeout = setTimeout(() => {
              resolveStop = null;
              done();
            }, STOP_TIMEOUT_MS);
            resolveStop = () => {
              clearTimeout(timeout);
              done();
            };
            // Empty binary frame is the end signal; do not throw if the socket already closed.
            try {
              socket.send(Buffer.alloc(0));
            } catch {
              clearTimeout(timeout);
              done();
            }
          });
          clearKeepalive();
          stopped = true;
          socket.close();
        },
      });
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) return;

      let response: ServerResponse;
      try {
        response = JSON.parse(data.toString()) as ServerResponse;
      } catch {
        return;
      }

      if (response.finished === true) {
        finishedSeen = true;
        clearKeepalive();
        if (socket.readyState === WebSocket.OPEN) socket.close();
        return;
      }

      if (typeof response.error_code === "number") {
        errored = true;
        emit({
          type: "state",
          state: "error",
          message:
            response.error_message ?? `Transcription server error (code ${response.error_code})`,
          retryable: response.error_code !== 401 && response.error_code !== 402,
        });
        return;
      }

      if (Array.isArray(response.tokens)) {
        const final: Token[] = [];
        const pending: Token[] = [];
        for (const raw of response.tokens) {
          if (raw.is_final !== true) pending.push(toToken(raw));
          else if (raw.text !== END_TOKEN_TEXT) final.push(toToken(raw));
        }
        emit({ type: "tokens", final, pending });
      }
    });

    socket.on("close", () => {
      clearTimeout(connectTimeout);
      clearKeepalive();
      if (resolveStop !== null) {
        const done = resolveStop;
        resolveStop = null;
        done();
      }
      if (!stopped && !finishedSeen && !errored && settled) {
        emit({
          type: "state",
          state: "error",
          message: "Connection lost. Reconnecting automatically",
          retryable: true,
        });
      }
    });

    socket.on("error", (error) => {
      if (!settled) {
        settleReject(
          new Error(`Could not connect to transcription server (check network): ${error.message}`),
        );
        return;
      }
      errored = true;
      emit({
        type: "state",
        state: "error",
        message: `Connection error: ${error.message}`,
        retryable: true,
      });
    });
  });
}
