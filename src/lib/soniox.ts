import WebSocket from "ws";

import { DEFAULT_REGION } from "#/lib/region.js";
import type { SttEvent, SttOptions, SttRegion, SttSession, Token } from "#/lib/types";

export const STT_MODEL = "stt-rt-v5";

const CONNECT_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
// Server drops after 20s silence; keepalive at half that interval.
const KEEPALIVE_INTERVAL_MS = 10_000;
// ~50 × 3200-byte frames ≈ 5s; drop audio when backlog exceeds this.
const BACKLOG_LIMIT_BYTES = 160 * 1024;

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
  if (raw.speaker !== undefined) token.speaker = raw.speaker;
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

function isFatalErrorCode(code: number) {
  return code === 401 || code === 402;
}

export function startSession({ apiKey, model, region, clientReferenceId, onEvent }: SttOptions) {
  return new Promise<SttSession>((resolve, reject) => {
    onEvent({ type: "state", state: "connecting" });

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
      const config: Record<string, unknown> = {
        api_key: apiKey,
        model: model ?? STT_MODEL,
        audio_format: "pcm_s16le",
        sample_rate: 16000,
        num_channels: 1,
        language_hints: ["ko", "en"],
        enable_speaker_diarization: true,
        enable_endpoint_detection: true,
        endpoint_latency_adjustment_level: 1,
        max_endpoint_delay_ms: 1500,
      };
      if (clientReferenceId !== undefined) {
        config.client_reference_id = clientReferenceId;
      }
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
        emit({ type: "finished" });
        if (socket.readyState === WebSocket.OPEN) socket.close();
        return;
      }

      if (typeof response.error_code === "number" && response.error_code !== null) {
        const fatal = isFatalErrorCode(response.error_code);
        errored = true;
        emit({
          type: "state",
          state: "error",
          message:
            response.error_message ?? `Transcription server error (code ${response.error_code})`,
          retryable: !fatal,
        });
        return;
      }

      if (Array.isArray(response.tokens)) {
        const final = response.tokens
          .filter((t) => t.is_final === true && t.text !== END_TOKEN_TEXT)
          .map(toToken);
        const pending = response.tokens.filter((t) => t.is_final !== true).map(toToken);
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
