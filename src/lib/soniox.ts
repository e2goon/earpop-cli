import WebSocket from "ws";

import { languageGeneralContext, normalizeLanguageHints } from "#/lib/languages.js";
import { DEFAULT_REGION } from "#/lib/region.js";
import type { SttEvent, SttOptions, SttRegion, SttSession, Token } from "#/lib/types.js";

export const STT_MODEL = "stt-rt-v6";

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
  translation_status?: string;
  source_language?: string;
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
  if (raw.translation_status === "translation") {
    token.translation = true;
    if (raw.source_language !== undefined) token.sourceLanguage = raw.source_language;
  }
  return token;
}

const END_TOKEN_TEXT = "<end>";

// Bad request, key, balance, or permission: reconnecting cannot fix these.
// 408, 413 (session length cap), 429, and 5xx are worth a reconnect.
const PERMANENT_ERROR_CODES = new Set([400, 401, 402, 403]);

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
  terms,
  translation,
  onEvent,
}: SttOptions) {
  const twoWay = translation?.length === 2 ? translation : undefined;
  // Both sides of a two-way translation are spoken, so both belong in the hints.
  const hints = normalizeLanguageHints([...(languageHints ?? []), ...(twoWay ?? [])]);
  return new Promise<SttSession>((resolve, reject) => {
    // The start-request api_key field is deprecated; the key travels with the handshake.
    const socket = new WebSocket(REGION_WEBSOCKET_URLS[region ?? DEFAULT_REGION], {
      perMessageDeflate: false,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${apiKey}` },
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
    socket.on("open", () => {
      // Endpoint off: provisional streams fast; finals come later with better word/diarization accuracy.
      const config = {
        model: STT_MODEL,
        audio_format: "pcm_s16le",
        sample_rate: 16000,
        num_channels: 1,
        language_hints: hints,
        // Strict is strongest with a single language; multiple hints stay a bias only.
        language_hints_strict: hints.length === 1 && twoWay === undefined,
        enable_speaker_diarization: true,
        // Tags each token with its language; captions and exports use it to split mixed speech.
        enable_language_identification: true,
        enable_endpoint_detection: false,
        context: {
          general: languageGeneralContext(hints),
          text: contextText || undefined,
          terms: terms !== undefined && terms.length > 0 ? terms : undefined,
        },
        client_reference_id: clientReferenceId,
        translation:
          twoWay !== undefined
            ? { type: "two_way", language_a: twoWay[0], language_b: twoWay[1] }
            : translation?.length === 1
              ? { type: "one_way", target_language: translation[0] }
              : undefined,
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
            // An empty text frame ends the audio; Soniox ignores an empty binary frame.
            try {
              socket.send("");
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

      if (typeof response.error_code === "number") {
        errored = true;
        emit({
          type: "state",
          state: "error",
          message:
            response.error_message ?? `Transcription server error (code ${response.error_code})`,
          retryable: !PERMANENT_ERROR_CODES.has(response.error_code),
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

      if (response.finished === true) {
        finishedSeen = true;
        clearKeepalive();
        // Unrequested finish (e.g. stream time limit): report it so the controller reconnects.
        if (resolveStop === null) {
          emit({
            type: "state",
            state: "error",
            message: "Session ended by the server",
            retryable: true,
          });
        }
        if (socket.readyState === WebSocket.OPEN) socket.close();
      }
    });

    socket.on("close", () => {
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
          message: "Connection lost",
          retryable: true,
        });
      }
    });

    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(
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
