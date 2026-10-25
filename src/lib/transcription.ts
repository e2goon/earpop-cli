import { startCapture } from "#/lib/audio.js";
import { errorMessage } from "#/lib/errors.js";
import { languageHintLabel, normalizeLanguageHints, type SttLanguage } from "#/lib/languages.js";
import { createSerialQueue } from "#/lib/serial-queue.js";
import { saveSettings } from "#/lib/settings.js";
import { appendSttContext, startSession } from "#/lib/soniox.js";
import type { AudioCapture, Journal, SttRegion, SttSession, SttState, Token } from "#/lib/types.js";

const TAIL_CHARS = 2_000;

// Throttle non-token paints (elapsed clock). Token snapshots paint immediately.
const UI_EMIT_INTERVAL_MS = 150;

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_STABLE_MS = 30_000;
const NOTICE_MS = 4_000;
const MIC_LOST = "Press m to choose another microphone";
const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

type LiveState = Exclude<SttState, "stopped">;

export interface TranscriptionSnapshot {
  state: LiveState;
  stateMessage?: string;
  notice?: string;
  device: string;
  finalTokens: Token[];
  pendingTokens: Token[];
  elapsedSeconds: number;
}

interface TranscriptionOptions {
  journal: Journal;
  apiKey: string;
  device?: string;
  clientReferenceId: string;
  region?: SttRegion;
  languageHints?: SttLanguage[];
  onSnapshot: (snapshot: TranscriptionSnapshot) => void;
  onFatal: (message: string) => void;
}

export type TranscriptionController = ReturnType<typeof createTranscription>;

export function createTranscription({
  journal,
  apiKey,
  device: deviceOption,
  clientReferenceId,
  region,
  languageHints: languageHintsOption,
  onSnapshot,
  onFatal,
}: TranscriptionOptions) {
  let device = deviceOption ?? "default";
  let languageHints = normalizeLanguageHints(languageHintsOption);
  let capture: AudioCapture | null = null;
  let session: SttSession | null = null;

  let stopped = false;
  let connecting = false;
  // Invalidate in-flight startSession() so soft-reconnect cannot adopt a stale socket.
  let connectGeneration = 0;
  const closingSessions = new Set<Promise<void>>();

  let paused = false;
  let pausedAtMs = 0;
  let pausedTotalMs = 0;

  // Serialize togglePause/switchMicrophone/setLanguageHints/stop — overlapping ops can open capture atop teardown.
  const enqueue = createSerialQueue();

  let state: LiveState = "connecting";
  let stateMessage: string | undefined;
  let notice: string | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const history: Token[] = [];
  let tailStart = 0;
  let tailChars = 0;
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
      notice,
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

  function flash(message: string) {
    notice = message;
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = undefined;
      noticeTimer = null;
      emit(true);
    }, NOTICE_MS);
    emit(true);
  }

  // A new session starts mid-conversation; keep a space after the previous session's last word
  // unless either side is a script written without spaces.
  function spaceAfterPrevious(tokens: Token[]) {
    const previous = history.at(-1);
    const first = tokens[0];
    if (previous === undefined || first === undefined) return tokens;
    if (/\s$/.test(previous.text) || /^\s/.test(first.text)) return tokens;
    if (
      NO_SPACE_SCRIPT.test(previous.text.slice(-1)) ||
      NO_SPACE_SCRIPT.test(first.text.charAt(0))
    ) {
      return tokens;
    }
    return [{ ...first, text: ` ${first.text}` }, ...tokens.slice(1)];
  }

  function addFinals(tokens: Token[]) {
    history.push(...tokens);
    for (const token of tokens) tailChars += token.text.length;
    while (tailChars > TAIL_CHARS && history.length - tailStart > 1) {
      tailChars -= history[tailStart]!.text.length;
      tailStart += 1;
    }
    finalTokens = history.slice(tailStart);
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
    releaseSession();
    // Clear connecting or a pending connect() guards forever and reconnect never runs.
    connecting = false;
    state = "connecting";
    stateMessage = `${message}, retrying in ${Math.round(backoffMs / 1000)}s`;
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
    const generation = ++connectGeneration;
    let offsetMs = 0;
    let sessionHasFinal = false;
    state = "connecting";
    stateMessage = undefined;
    emit(true);

    try {
      const nextSession = await startSession({
        apiKey,
        clientReferenceId,
        region,
        languageHints,
        contextText: speechContext,
        onEvent: (event) => {
          if (stopped) return;
          if (event.type === "tokens") {
            if (event.final.length > 0) {
              const final = sessionHasFinal ? event.final : spaceAfterPrevious(event.final);
              sessionHasFinal = true;
              journal.tokens({ tokens: final, offsetMs });
              addFinals(final);
              speechContext = appendSttContext({ text: speechContext, tokens: final });
            }
            // A replaced session still delivers its last finals; only the current one owns the provisional line.
            if (generation === connectGeneration) {
              pendingTokens = sessionHasFinal ? event.pending : spaceAfterPrevious(event.pending);
            }
            // Captions first: do not coalesce provisional tokens behind the paint interval.
            emit(true);
            return;
          }
          if (generation !== connectGeneration) return;
          if (event.type === "state") {
            if (event.state === "listening") {
              connecting = false;
              listeningSinceMs = Date.now();
              offsetMs = journal.session(device);
              if (capture !== null) {
                state = "listening";
                stateMessage = undefined;
              } else {
                state = "error";
                stateMessage = MIC_LOST;
              }
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
          }
        },
      });
      if (generation !== connectGeneration || stopped || paused) {
        void nextSession.stop().catch(() => {});
        if (generation === connectGeneration) connecting = false;
        return;
      }
      session = nextSession;
      connecting = false;
    } catch (error) {
      if (generation !== connectGeneration) return;
      connecting = false;
      if (stopped) return;
      scheduleReconnect(errorMessage(error));
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
        capture = null;
        state = "error";
        stateMessage = `${message}. ${MIC_LOST}`;
        emit(true);
      },
    });
  }

  function releaseSession() {
    if (session === null) return;
    const closed = session.stop().catch(() => {});
    session = null;
    closingSessions.add(closed);
    void closed.then(() => closingSessions.delete(closed));
  }

  async function stopCapture() {
    try {
      await capture?.stop();
    } catch {}
    capture = null;
  }

  async function teardownIO() {
    await stopCapture();
    releaseSession();
    await Promise.all(closingSessions);
  }

  return {
    getHistory() {
      return history;
    },

    start() {
      return enqueue(async () => {
        if (stopped) return;
        startedAtMs = Date.now();
        capture = await openCapture(device);
        device = capture.device;
        emit();

        startElapsedTimer();
        void connect();
      });
    },

    togglePause() {
      return enqueue(async () => {
        if (stopped) return;

        if (!paused) {
          paused = true;
          connectGeneration += 1;
          pausedAtMs = Date.now();
          state = "paused";
          pendingTokens = [];
          clearTimers();
          emit(true);
          releaseSession();
          await stopCapture();
          return;
        }

        paused = false;
        pausedTotalMs += Date.now() - pausedAtMs;
        pausedAtMs = 0;
        state = "connecting";
        stateMessage = undefined;
        emit(true);
        try {
          capture = await openCapture(device);
        } catch (error) {
          state = "error";
          stateMessage = errorMessage(error);
          emit(true);
          return;
        }
        startElapsedTimer();
        await connect();
      });
    },

    switchMicrophone(name: string) {
      return enqueue(async () => {
        if (stopped || (name === device && (paused || capture !== null))) return;

        if (paused) {
          device = name;
          await saveSettings({ microphone: name });
          flash(`Switched microphone to ${name}`);
          return;
        }

        try {
          const previousCapture = capture;
          const next = await openCapture(name);
          void previousCapture?.stop().catch(() => {});
          capture = next;
          device = next.device;
          journal.session(device);
          if (state === "error") {
            state = session !== null ? "listening" : "connecting";
            stateMessage = undefined;
          }
          await saveSettings({ microphone: device });
          flash(`Switched microphone to ${device}`);
        } catch (error) {
          const kept = capture !== null ? " (keeping the previous microphone)" : "";
          flash(`Failed to switch microphone: ${errorMessage(error)}${kept}`);
        }
      });
    },

    setLanguageHints(codes: SttLanguage[]) {
      return enqueue(async () => {
        if (stopped) return;
        const next = normalizeLanguageHints(codes);
        if (sameLanguageHints(languageHints, next)) return;

        languageHints = next;
        await saveSettings({ languages: next });
        flash(`Languages set to ${languageHintLabel(next)}`);
        if (paused) return;

        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        // Drop provisional captions from the previous language session.
        pendingTokens = [];
        // Invalidate any in-flight connect() before opening a replacement session.
        connectGeneration += 1;
        connecting = false;
        releaseSession();
        emit(true);
        await connect();
      });
    },

    stop() {
      return enqueue(async () => {
        if (stopped) return;
        connectGeneration += 1;
        clearTimers();

        // Not stopped yet: closing sessions still deliver their last finals, which must reach the journal.
        await teardownIO();
        stopped = true;
        if (noticeTimer !== null) clearTimeout(noticeTimer);
        journal.close();
      });
    },
  };
}

function sameLanguageHints(a: SttLanguage[], b: SttLanguage[]) {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((code) => other.has(code));
}
