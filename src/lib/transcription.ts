import { startCapture } from "#/lib/audio.js";
import { createUtteranceStream, type CommittedUtterance } from "#/lib/caption-layout.js";
import { errorMessage } from "#/lib/errors.js";
import {
  languageHintLabel,
  NO_SPACE_SCRIPT,
  normalizeLanguageHints,
  normalizeTranslation,
  translationLabel,
  type SttLanguage,
} from "#/lib/languages.js";
import { createSerialQueue } from "#/lib/serial-queue.js";
import { saveSettings } from "#/lib/settings.js";
import { appendSttContext, startSession } from "#/lib/soniox.js";
import type { AudioCapture, Journal, SttRegion, SttSession, SttState, Token } from "#/lib/types.js";

// Throttle non-token paints (elapsed clock). Token snapshots paint immediately.
const UI_EMIT_INTERVAL_MS = 150;

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_STABLE_MS = 30_000;
const NOTICE_MS = 4_000;
const MIC_LOST = "Press m to choose another microphone";
// A microphone that stops sending frames (Bluetooth headsets switching profile do this) is
// reopened; after a few tries in a short window the user is asked to pick another one.
const STALL_MS = 3_000;
const STALL_RETRY_WINDOW_MS = 60_000;
const STALL_MAX_RETRIES = 3;

type LiveState = Exclude<SttState, "stopped">;

export interface TranscriptionSnapshot {
  state: LiveState;
  stateMessage?: string;
  notice?: string;
  device: string;
  languages: SttLanguage[];
  translation: SttLanguage[];
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
  terms?: string[];
  translation?: SttLanguage[];
  onCommit?: (utterances: CommittedUtterance[]) => void;
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
  terms,
  translation: translationOption,
  onCommit,
  onSnapshot,
  onFatal,
}: TranscriptionOptions) {
  let device = deviceOption ?? "default";
  let languageHints = normalizeLanguageHints(languageHintsOption);
  let translation = normalizeTranslation(translationOption);
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

  // Serialize togglePause/switchMicrophone/setLanguageHints/setTranslation/stop — overlapping ops can open capture atop teardown.
  const enqueue = createSerialQueue();

  let state: LiveState = "connecting";
  let stateMessage: string | undefined;
  let notice: string | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const utteranceStream = createUtteranceStream();
  const heardLanguagesSet = new Set<string>();
  let lastFinalText = "";
  let finalTokens: Token[] = [];
  let pendingTokens: Token[] = [];
  let speechContext = "";
  let startedAtMs = 0;
  let listeningSinceMs = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = BACKOFF_INITIAL_MS;
  let lastFrameAtMs = 0;
  let reopening = false;
  let stallRetries: number[] = [];

  let lastEmitAt = 0;
  let trailingEmit: ReturnType<typeof setTimeout> | null = null;

  function paint() {
    lastEmitAt = Date.now();
    onSnapshot({
      state,
      stateMessage,
      notice,
      device,
      languages: languageHints,
      translation,
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
    const first = tokens[0];
    if (lastFinalText === "" || first === undefined) return tokens;
    if (/\s$/.test(lastFinalText) || /^\s/.test(first.text)) return tokens;
    if (
      NO_SPACE_SCRIPT.test(lastFinalText.slice(-1)) ||
      NO_SPACE_SCRIPT.test(first.text.charAt(0))
    ) {
      return tokens;
    }
    return [{ ...first, text: ` ${first.text}` }, ...tokens.slice(1)];
  }

  function addFinals(tokens: Token[]) {
    for (const token of tokens) {
      if (token.language !== undefined && token.text.trim() !== "") {
        heardLanguagesSet.add(token.language);
      }
    }
    const last = tokens.at(-1);
    if (last !== undefined) lastFinalText = last.text;
    const committed = utteranceStream.push(tokens);
    finalTokens = utteranceStream.activeTokens();
    if (committed.length > 0) onCommit?.(committed);
  }

  function flushActiveUtterance() {
    const committed = utteranceStream.flush();
    finalTokens = [];
    if (committed.length > 0) onCommit?.(committed);
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
    // No microphone, no session: an open stream with nothing to send would only cost money.
    if (stopped || paused || connecting || capture === null) return;
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
        terms,
        translation,
        onEvent: (event) => {
          if (stopped) return;
          if (event.type === "tokens") {
            if (
              event.final.length === 0 &&
              event.pending.length === 0 &&
              pendingTokens.length === 0
            ) {
              return;
            }
            if (event.final.length > 0) {
              const final = sessionHasFinal ? event.final : spaceAfterPrevious(event.final);
              sessionHasFinal = true;
              journal.tokens({ tokens: final, offsetMs });
              addFinals(final);
              // Only speech biases recognition; translated text would skew it toward the target.
              speechContext = appendSttContext({
                text: speechContext,
                tokens: final.filter((token) => token.translation !== true),
              });
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
                dropSession();
                clearTimers();
                if (noticeTimer !== null) {
                  clearTimeout(noticeTimer);
                  noticeTimer = null;
                }
                state = "error";
                stateMessage = event.message;
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
      if (!reopening && capture !== null && Date.now() - lastFrameAtMs > STALL_MS) {
        reopening = true;
        void enqueue(reopenStalledCapture).finally(() => {
          reopening = false;
        });
      }
      emit();
    }, 1_000);
  }

  // The microphone is gone: stop streaming to Soniox until the user picks one.
  function loseMicrophone(message: string) {
    capture = null;
    dropSession();
    state = "error";
    stateMessage = `${message}. ${MIC_LOST}`;
    emit(true);
  }

  async function openCapture(name: string) {
    const owned = { active: true };
    const opened = await startCapture({
      device: name,
      onFrame: (frame) => {
        if (!owned.active || stopped) return;
        lastFrameAtMs = Date.now();
        session?.sendAudio(frame);
      },
      onError: (message) => {
        if (!owned.active || stopped) return;
        loseMicrophone(message);
      },
    });
    lastFrameAtMs = Date.now();
    return {
      device: opened.device,
      stop: async () => {
        owned.active = false;
        await opened.stop();
      },
    };
  }

  async function reopenStalledCapture() {
    // Queued behind other work: a switched or recovered microphone may be flowing again by now.
    if (stopped || paused || capture === null || Date.now() - lastFrameAtMs <= STALL_MS) return;
    const now = Date.now();
    stallRetries = stallRetries.filter((at) => now - at < STALL_RETRY_WINDOW_MS);
    await stopCapture();
    if (stallRetries.length >= STALL_MAX_RETRIES) {
      loseMicrophone(`No audio from ${device}`);
      return;
    }
    stallRetries.push(now);
    try {
      capture = await openCapture(device);
    } catch (error) {
      loseMicrophone(errorMessage(error));
      return;
    }
    flash("No audio from the microphone; reopened it");
    // Soniox timestamps count received audio, so the gap would shift every later timestamp;
    // a fresh session starts a new offset in the journal.
    dropSession();
    void connect();
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

  // Session options changed: open a replacement session, keeping the microphone running.
  async function restartSession() {
    if (paused) return;
    dropSession();
    emit(true);
    await connect();
  }

  // Closes the current session, cancels any pending or in-flight connect, and clears the
  // provisional captions that belonged to it.
  function dropSession() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectGeneration += 1;
    connecting = false;
    releaseSession();
    pendingTokens = [];
  }

  async function teardownIO() {
    await stopCapture();
    releaseSession();
    await Promise.all(closingSessions);
  }

  return {
    getHeardLanguages() {
      return [...heardLanguagesSet];
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
          pausedAtMs = Date.now();
          state = "paused";
          clearTimers();
          dropSession();
          emit(true);
          await stopCapture();
          if (closingSessions.size === 0) {
            if (paused && !stopped) {
              flushActiveUtterance();
              emit(true);
            }
          } else {
            void Promise.all(closingSessions).then(() => {
              if (paused && !stopped) {
                flushActiveUtterance();
                emit(true);
              }
            });
          }
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
          try {
            await saveSettings({ microphone: name });
            device = name;
            flash(`Switched microphone to ${name}`);
          } catch (error) {
            flash(`Failed to switch microphone: ${errorMessage(error)}`);
            throw error;
          }
          return;
        }

        try {
          const previousCapture = capture;
          const next = await openCapture(name);
          void previousCapture?.stop().catch(() => {});
          capture = next;
          device = next.device;
          journal.session(device);
          stallRetries = [];
          // A failed resume never restarted the clock, which also drives stall detection.
          if (elapsedTimer === null) startElapsedTimer();
          if (state === "error" && session !== null) {
            state = "listening";
            stateMessage = undefined;
          }
          // The session was closed when the old microphone was lost; connect() sets the state.
          if (session === null) void connect();
          await saveSettings({ microphone: device });
          flash(`Switched microphone to ${device}`);
        } catch (error) {
          const kept = capture !== null ? " (keeping the previous microphone)" : "";
          flash(`Failed to switch microphone: ${errorMessage(error)}${kept}`);
          throw error;
        }
      });
    },

    setLanguageHints(codes: SttLanguage[]) {
      return enqueue(async () => {
        if (stopped) return;
        const next = normalizeLanguageHints(codes);
        if (sameCodes(languageHints, next)) return;

        // Save first: a failed save leaves the running session and snapshot unchanged.
        await saveSettings({ languages: next });
        languageHints = next;
        flash(`Languages set to ${languageHintLabel(next)}`);
        await restartSession();
      });
    },

    setTranslation(codes: SttLanguage[]) {
      return enqueue(async () => {
        if (stopped) return;
        const next = normalizeTranslation(codes);
        if (sameCodes(translation, next)) return;

        await saveSettings({ translation: next });
        translation = next;
        flash(`Translation: ${translationLabel(next)}`);
        await restartSession();
      });
    },

    stop() {
      return enqueue(async () => {
        if (stopped) return;
        connectGeneration += 1;
        clearTimers();

        // Not stopped yet: closing sessions still deliver their last finals, which must reach the journal.
        await teardownIO();
        flushActiveUtterance();
        emit(true);
        stopped = true;
        if (noticeTimer !== null) clearTimeout(noticeTimer);
        journal.close();
      });
    },
  };
}

function sameCodes(a: SttLanguage[], b: SttLanguage[]) {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((code) => other.has(code));
}
