import { startCapture } from "#/lib/audio.js";
import { saveSettings } from "#/lib/settings.js";
import { appendSttContext, startSession } from "#/lib/soniox.js";
import type { AudioCapture, Journal, SttRegion, SttSession, SttState, Token } from "#/lib/types.js";

const TAIL_CHARS = 2_000;

// Throttle non-token paints (elapsed clock). Token snapshots paint immediately.
const UI_EMIT_INTERVAL_MS = 150;

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_STABLE_MS = 30_000;

type LiveState = Exclude<SttState, "stopped">;

export interface TranscriptionSnapshot {
  state: LiveState;
  stateMessage?: string;
  device: string;
  finalTokens: Token[];
  pendingTokens: Token[];
  elapsedSeconds: number;
}

export interface TranscriptionOptions {
  journal: Journal;
  apiKey: string;
  device?: string;
  clientReferenceId: string;
  region?: SttRegion;
  onSnapshot: (snapshot: TranscriptionSnapshot) => void;
  onFatal: (message: string) => void;
}

export interface TranscriptionController {
  start(): Promise<void>;
  togglePause(): Promise<void>;
  switchMicrophone(name: string): Promise<void>;
  stop(): Promise<void>;
}

export function createTranscription({
  journal,
  apiKey,
  device: deviceOption,
  clientReferenceId,
  region,
  onSnapshot,
  onFatal,
}: TranscriptionOptions) {
  let device = deviceOption ?? "default";
  let capture: AudioCapture | null = null;
  let session: SttSession | null = null;

  let stopped = false;
  let connecting = false;

  let paused = false;
  let pausedAtMs = 0;
  let pausedTotalMs = 0;

  // Serialize togglePause/switchMicrophone/stop — overlapping ops can open capture atop teardown.
  let opChain: Promise<void> = Promise.resolve();
  function enqueue(op: () => Promise<void>) {
    const run = opChain.then(op, op);
    opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  let state: LiveState = "connecting";
  let stateMessage: string | undefined;
  let finalTokens: Token[] = [];
  let pendingTokens: Token[] = [];
  let speechContext = "";
  let startedAtMs = 0;
  let listeningSinceMs = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = BACKOFF_INITIAL_MS;

  let lastEmitAt = 0;
  let trailingEmit: ReturnType<typeof setTimeout> | null = null;

  function paint() {
    lastEmitAt = Date.now();
    onSnapshot({
      state,
      stateMessage,
      device,
      finalTokens,
      pendingTokens,
      elapsedSeconds:
        startedAtMs === 0
          ? 0
          : Math.floor(((paused ? pausedAtMs : Date.now()) - startedAtMs - pausedTotalMs) / 1000),
    });
  }

  function emit(force = false) {
    if (stopped) return;
    if (force) {
      if (trailingEmit !== null) {
        clearTimeout(trailingEmit);
        trailingEmit = null;
      }
      paint();
      return;
    }
    const since = Date.now() - lastEmitAt;
    if (since >= UI_EMIT_INTERVAL_MS) {
      paint();
      return;
    }
    if (trailingEmit === null) {
      trailingEmit = setTimeout(() => {
        trailingEmit = null;
        paint();
      }, UI_EMIT_INTERVAL_MS - since);
    }
  }

  function pushTail(tokens: Token[]) {
    finalTokens = [...finalTokens, ...tokens];
    let total = finalTokens.reduce((sum, token) => sum + token.text.length, 0);
    while (total > TAIL_CHARS && finalTokens.length > 1) {
      total -= finalTokens[0]!.text.length;
      finalTokens = finalTokens.slice(1);
    }
  }

  function clearTimers() {
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (trailingEmit !== null) {
      clearTimeout(trailingEmit);
      trailingEmit = null;
    }
  }

  function scheduleReconnect(message: string) {
    // Clear connecting or a pending connect() guards forever and reconnect never runs.
    connecting = false;
    state = "connecting";
    stateMessage = `${message} — reconnecting in ${Math.round(backoffMs / 1000)}s`;
    emit(true);

    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped && !paused) void connect();
    }, delay);
  }

  async function connect() {
    if (stopped || paused || connecting) return;
    connecting = true;
    state = "connecting";
    stateMessage = undefined;
    emit(true);

    try {
      session = await startSession({
        apiKey,
        clientReferenceId,
        region,
        contextText: speechContext.length > 0 ? speechContext : undefined,
        onEvent: (event) => {
          if (stopped) return;
          if (event.type === "state") {
            if (event.state === "listening") {
              connecting = false;
              listeningSinceMs = Date.now();
              state = "listening";
              stateMessage = undefined;
              journal.session(device);
            } else if (event.state === "error") {
              if (event.retryable === true) {
                scheduleReconnect(event.message ?? "Connection error");
              } else {
                state = "error";
                stateMessage = event.message;
                clearTimers();
                void teardownIO();
                onFatal(event.message ?? "Cannot continue transcription");
              }
            }
            emit(true);
          } else if (event.type === "tokens") {
            if (event.final.length > 0) {
              journal.tokens(event.final);
              pushTail(event.final);
              speechContext = appendSttContext({ text: speechContext, tokens: event.final });
            }
            pendingTokens = event.pending;
            // Captions first: do not coalesce provisional tokens behind the paint interval.
            emit(true);
          } else if (event.type === "finished") {
          }
        },
      });
    } catch (error) {
      connecting = false;
      if (stopped) return;
      scheduleReconnect(error instanceof Error ? error.message : String(error));
      return;
    }

    connecting = false;
    if (stopped || paused) {
      const orphan = session;
      session = null;
      void orphan?.stop().catch(() => {});
    }
  }

  function startElapsedTimer() {
    if (elapsedTimer !== null) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      if (
        state === "listening" &&
        listeningSinceMs > 0 &&
        Date.now() - listeningSinceMs >= BACKOFF_STABLE_MS
      ) {
        backoffMs = BACKOFF_INITIAL_MS;
      }
      emit();
    }, 1_000);
  }

  function openCapture(name: string) {
    return startCapture({
      device: name,
      onFrame: (frame) => {
        session?.sendAudio(frame);
      },
      onError: (message) => {
        stateMessage = message;
        emit(true);
      },
    });
  }

  async function teardownIO() {
    try {
      await capture?.stop();
    } catch {}
    capture = null;

    try {
      await session?.stop();
    } catch {}
    session = null;
  }

  return {
    async start() {
      startedAtMs = Date.now();
      capture = await openCapture(device);
      device = capture.device;
      emit();

      startElapsedTimer();
      await connect();
    },

    togglePause() {
      return enqueue(async () => {
        if (stopped) return;

        if (!paused) {
          paused = true;
          pausedAtMs = Date.now();
          state = "paused";
          pendingTokens = [];
          clearTimers();
          await teardownIO();
          emit(true);
          return;
        }

        paused = false;
        pausedTotalMs += Date.now() - pausedAtMs;
        pausedAtMs = 0;
        try {
          capture = await openCapture(device);
        } catch (error) {
          state = "error";
          stateMessage = error instanceof Error ? error.message : String(error);
          emit(true);
          return;
        }
        stateMessage = undefined;
        startElapsedTimer();
        emit(true);
        await connect();
      });
    },

    switchMicrophone(name: string) {
      return enqueue(async () => {
        if (name === device || stopped) return;
        const previous = device;

        if (paused) {
          device = name;
          await saveSettings({ microphone: name });
          stateMessage = `Switched microphone to ${name}`;
          emit(true);
          return;
        }

        try {
          const previousCapture = capture;
          const next = await openCapture(name);
          void previousCapture?.stop().catch(() => {});
          capture = next;
          device = next.device;
          journal.session(device);
          await saveSettings({ microphone: device });
          stateMessage = `Switched microphone to ${device}`;
        } catch (error) {
          stateMessage = `Failed to switch microphone: ${
            error instanceof Error ? error.message : String(error)
          } (keeping previous microphone)`;
          emit(true);
          try {
            capture = await openCapture(previous);
            device = capture.device;
            journal.session(device);
            await saveSettings({ microphone: device });
          } catch {
            stateMessage = "Failed to restore microphone. Press ESC to quit, then run again";
          }
        }
        emit(true);
      });
    },

    stop() {
      return enqueue(async () => {
        if (stopped) return;
        stopped = true;
        clearTimers();

        await teardownIO();
        journal.close();
        emit(true);
      });
    },
  };
}
