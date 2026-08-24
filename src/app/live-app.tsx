import { Text, Box, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAlternateScreen } from "#/hooks/use-alternate-screen.js";
import { useInterrupt } from "#/hooks/use-interrupt.js";
import {
  createTranscription,
  type TranscriptionController,
  type TranscriptionSnapshot,
} from "#/lib/transcription.js";
import { copyToClipboard, osc52Sequence } from "#/lib/clipboard.js";
import { deleteApiKey, loadApiKey, saveApiKey } from "#/lib/api-key.js";
import { openJournal } from "#/lib/journal.js";
import {
  DEFAULT_LANGUAGE_HINTS,
  languageHintLabel,
  normalizeLanguageHints,
  type SttLanguage,
} from "#/lib/languages.js";
import { listMicrophones } from "#/lib/microphones.js";
import { regionLabel, resolveRegion } from "#/lib/region.js";
import { saveSettings, loadSettings } from "#/lib/settings.js";
import { STT_MODEL } from "#/lib/soniox.js";
import { verifyApiKey } from "#/lib/verify-key.js";
import type { Microphone, SttRegion } from "#/lib/types.js";
import { quit } from "#/app/runtime.js";
import { printSessionEnd } from "#/app/session-end.js";
import { CaptionScreen, type CaptionOverlay } from "#/screens/caption.js";
import { KeySetup } from "#/screens/key-setup.js";
import { MicrophoneSelect } from "#/components/microphone-select.js";
import { RegionSelect } from "#/screens/region-select.js";

type LivePhase = "boot" | "region-select" | "key-setup" | "mic-select" | "live" | "ended" | "fatal";

const STOP_TIMEOUT_MS = 3_000;

const CLOSED_OVERLAY: CaptionOverlay = { kind: "none" };

function FatalScreen(props: { message: string; onQuit: () => void }) {
  useInput((_input, key) => {
    if (key.escape) props.onQuit();
  });
  return (
    <Box flexDirection="column">
      <Text color="red">{`Cannot continue transcription: ${props.message}`}</Text>
      <Text dimColor>Press ESC to quit, fix the issue, then run earpop again</Text>
    </Box>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SettingsOverlay = Extract<CaptionOverlay, { kind: "settings" }>;

function patchSettingsOverlay({
  prev,
  patch,
}: {
  prev: CaptionOverlay;
  patch: Partial<SettingsOverlay>;
}) {
  if (prev.kind !== "settings") return prev;
  return { ...prev, ...patch };
}

export function LiveApp() {
  const [phase, setPhase] = useState<LivePhase>("boot");
  const [verifying, setVerifying] = useState(false);
  const [keyError, setKeyError] = useState<string | undefined>();
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [micsLoading, setMicsLoading] = useState(true);
  const [micNotice, setMicNotice] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<TranscriptionSnapshot | null>(null);
  const [overlay, setOverlay] = useState<CaptionOverlay>(CLOSED_OVERLAY);

  const controllerRef = useRef<TranscriptionController | null>(null);
  const journalPathRef = useRef<string | null>(null);
  const fatalMessageRef = useRef<string | null>(null);
  const regionRef = useRef<SttRegion>("us");
  const languageHintsRef = useRef<SttLanguage[]>([...DEFAULT_LANGUAGE_HINTS]);
  // Invalidate in-flight overlay loads when the overlay closes or is replaced.
  const overlayEpochRef = useRef(0);

  const finish = useCallback(() => {
    const path = journalPathRef.current;
    quit(path === null ? undefined : () => printSessionEnd(path));
  }, []);

  // First Esc / Ctrl+C: stop session, keep path on screen. Second press: exit.
  const sessionEndedRef = useRef(false);
  const exitStartedRef = useRef(false);

  const copyJournalPath = useCallback(() => {
    const path = journalPathRef.current;
    if (path === null) return;
    const copied = copyToClipboard(path);
    if (!copied) process.stdout.write(osc52Sequence(path));
  }, []);

  const requestExit = useCallback(() => {
    if (sessionEndedRef.current || exitStartedRef.current || fatalMessageRef.current !== null) {
      if (exitStartedRef.current) {
        try {
          void controllerRef.current?.stop();
        } catch {
          // Prefer exit over a stuck stop().
        }
        process.exit(130);
      }
      exitStartedRef.current = true;
      finish();
      return;
    }

    sessionEndedRef.current = true;
    copyJournalPath();
    overlayEpochRef.current += 1;
    setOverlay(CLOSED_OVERLAY);
    setPhase("ended");

    const controller = controllerRef.current;
    if (controller === null) {
      finish();
      return;
    }
    void Promise.race([controller.stop(), delay(STOP_TIMEOUT_MS)]).then(() => {
      // Stay on ended screen until the next Esc / Ctrl+C.
    });
  }, [copyJournalPath, finish]);
  useInterrupt(requestExit);

  async function startLive({
    region,
    apiKey,
    deviceName,
  }: {
    region: SttRegion;
    apiKey: string;
    deviceName?: string;
  }) {
    const journal = openJournal(STT_MODEL);
    journalPathRef.current = journal.path;

    const controller = createTranscription({
      journal,
      apiKey,
      device: deviceName,
      clientReferenceId: journal.id,
      region,
      languageHints: languageHintsRef.current,
      onSnapshot: setSnapshot,
      onFatal: (message) => {
        fatalMessageRef.current = message;
        setPhase("fatal");
      },
    });
    controllerRef.current = controller;
    await controller.start();
    setPhase("live");
  }

  const chooseInitialMicrophone = useCallback(async (savedName: string | null) => {
    setMicsLoading(true);
    setPhase("mic-select");
    try {
      const found = await listMicrophones();
      setMicrophones(found);
      if (
        savedName !== null &&
        savedName !== "" &&
        !found.some((microphone) => microphone.name === savedName)
      ) {
        setMicNotice(
          `Previously selected microphone (${savedName}) is not connected. Pick one from the list.`,
        );
      }
    } catch (error) {
      setMicNotice(error instanceof Error ? error.message : String(error));
    }
    setMicsLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [settings, region] = await Promise.all([loadSettings(), resolveRegion()]);
      regionRef.current = region;
      languageHintsRef.current = normalizeLanguageHints(settings.languages);
      const apiKey = await loadApiKey(region);
      if (cancelled) return;
      if (apiKey === null) {
        setPhase("region-select");
        return;
      }
      const savedName = settings.microphone ?? null;
      if (savedName === null) {
        await chooseInitialMicrophone(null);
        return;
      }
      try {
        await startLive({ region, apiKey, deviceName: savedName });
      } catch (error) {
        fatalMessageRef.current = error instanceof Error ? error.message : String(error);
        setPhase("fatal");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot once on mount; startLive / chooseInitialMicrophone are intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [, setRenderTick] = useState(0);
  const repaint = useCallback(() => setRenderTick((value) => value + 1), []);
  useAlternateScreen({
    active: phase === "live" || phase === "ended" || phase === "boot",
    onRepaint: repaint,
  });

  if (phase === "boot") {
    return <Text>Preparing…</Text>;
  }

  if (phase === "region-select") {
    return (
      <RegionSelect
        onPick={(next) => {
          regionRef.current = next;
          void saveSettings({ region: next });
          setPhase("key-setup");
        }}
      />
    );
  }

  if (phase === "key-setup") {
    return (
      <KeySetup
        error={keyError}
        verifying={verifying}
        regionLabel={regionLabel(regionRef.current)}
        onSubmit={(key) => {
          setVerifying(true);
          setKeyError(undefined);
          void (async () => {
            const result = await verifyApiKey({
              key,
              region: regionRef.current,
              model: STT_MODEL,
            });
            if (!result.ok) {
              setKeyError(
                `${result.message}\nIf the region is wrong, press ESC to quit, then change it with 'earpop settings'.`,
              );
              setVerifying(false);
              return;
            }
            try {
              await saveApiKey({ key, region: regionRef.current });
            } catch (error) {
              setKeyError(error instanceof Error ? error.message : String(error));
              setVerifying(false);
              return;
            }
            setVerifying(false);
            const settings = await loadSettings();
            await chooseInitialMicrophone(settings.microphone ?? null);
          })();
        }}
      />
    );
  }

  if (phase === "mic-select") {
    return (
      <Box flexDirection="column">
        <Text>Choose a microphone</Text>
        {micNotice !== undefined ? (
          <Text color="yellow">{micNotice}</Text>
        ) : (
          <MicrophoneSelect
            microphones={microphones}
            loading={micsLoading}
            onPick={(name) => {
              void (async () => {
                await saveSettings({ microphone: name });
                const region = regionRef.current;
                const apiKey = await loadApiKey(region);
                if (apiKey === null) {
                  setPhase("region-select");
                  return;
                }
                try {
                  await startLive({ region, apiKey, deviceName: name });
                } catch (error) {
                  fatalMessageRef.current = error instanceof Error ? error.message : String(error);
                  setPhase("fatal");
                }
              })();
            }}
          />
        )}
      </Box>
    );
  }

  if (phase === "fatal") {
    return (
      <FatalScreen message={fatalMessageRef.current ?? "Unknown error"} onQuit={requestExit} />
    );
  }

  if (snapshot === null) {
    return <Text>Preparing…</Text>;
  }

  return (
    <CaptionScreen
      state={snapshot.state}
      stateMessage={snapshot.stateMessage}
      device={snapshot.device}
      finalTokens={snapshot.finalTokens}
      pendingTokens={snapshot.pendingTokens}
      elapsedSeconds={snapshot.elapsedSeconds}
      journalPath={journalPathRef.current ?? undefined}
      ended={phase === "ended"}
      overlay={overlay}
      onTogglePause={() => {
        if (phase === "ended") return;
        // Pause copies the transcript path to the clipboard on enter.
        if (snapshot.state !== "paused" && journalPathRef.current !== null) {
          copyJournalPath();
        }
        void controllerRef.current?.togglePause();
      }}
      onQuit={requestExit}
      onOpenMicrophones={() => {
        if (phase === "ended") return;
        const epoch = ++overlayEpochRef.current;
        setOverlay({ kind: "mic", microphones: [], loading: true });
        void listMicrophones()
          .then((found) => {
            if (epoch !== overlayEpochRef.current) return;
            setOverlay({ kind: "mic", microphones: found, loading: false });
          })
          .catch((error: unknown) => {
            if (epoch !== overlayEpochRef.current) return;
            setOverlay({
              kind: "mic",
              microphones: [],
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }}
      onOpenSettings={() => {
        if (phase === "ended") return;
        const epoch = ++overlayEpochRef.current;
        setOverlay({
          kind: "settings",
          microphones: [],
          microphonesLoading: true,
          currentMicrophone: snapshot.device,
          region: regionRef.current,
          languages: languageHintsRef.current,
          hasApiKey: true,
        });
        void (async () => {
          const [settings, resolved, found] = await Promise.all([
            loadSettings(),
            resolveRegion(),
            listMicrophones().catch(() => [] as Microphone[]),
          ]);
          if (epoch !== overlayEpochRef.current) return;
          const key = await loadApiKey(resolved);
          if (epoch !== overlayEpochRef.current) return;
          setOverlay({
            kind: "settings",
            microphones: found,
            microphonesLoading: false,
            currentMicrophone: settings.microphone ?? snapshot.device,
            region: resolved,
            // Live session hints are source of truth while connected.
            languages: languageHintsRef.current,
            hasApiKey: key !== null,
          });
        })();
      }}
      onPickMicrophone={(name) => {
        overlayEpochRef.current += 1;
        setOverlay(CLOSED_OVERLAY);
        void controllerRef.current?.switchMicrophone(name);
      }}
      onCloseMicrophones={() => {
        overlayEpochRef.current += 1;
        setOverlay(CLOSED_OVERLAY);
      }}
      onCloseSettings={() => {
        overlayEpochRef.current += 1;
        setOverlay(CLOSED_OVERLAY);
      }}
      onSettingsPickMicrophone={(name) => {
        void controllerRef.current
          ?.switchMicrophone(name)
          .then(() => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  currentMicrophone: name,
                  notice: `Microphone set to ${name}`,
                },
              }),
            );
          })
          .catch((error: unknown) => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  notice: `Failed to set microphone: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              }),
            );
          });
      }}
      onSettingsPickLanguages={(codes) => {
        languageHintsRef.current = normalizeLanguageHints(codes);
        void controllerRef.current
          ?.setLanguageHints(codes)
          .then(() => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  languages: languageHintsRef.current,
                  notice: `Languages set to ${languageHintLabel(languageHintsRef.current)}`,
                },
              }),
            );
          })
          .catch((error: unknown) => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  languages: languageHintsRef.current,
                  notice: `Failed to set languages: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              }),
            );
          });
      }}
      onSettingsPickRegion={(next) => {
        void saveSettings({ region: next })
          .then(async () => {
            const key = await loadApiKey(next);
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  region: next,
                  hasApiKey: key !== null,
                  notice: `Region set to ${regionLabel(next)} — applies after restart${
                    key === null ? " (register an API key for this region)" : ""
                  }`,
                },
              }),
            );
          })
          .catch((error: unknown) => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  notice: `Failed to save region: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              }),
            );
          });
      }}
      onSettingsChangeApiKey={(key) => {
        const region =
          overlay.kind === "settings" ? (overlay.region ?? regionRef.current) : regionRef.current;
        void saveApiKey({ key, region })
          .then(() => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  hasApiKey: true,
                  notice: `Saved API key for ${regionLabel(region)} — applies after restart`,
                },
              }),
            );
          })
          .catch((error: unknown) => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  notice: `Failed to save API key: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              }),
            );
          });
      }}
      onSettingsDeleteApiKey={() => {
        const region =
          overlay.kind === "settings" ? (overlay.region ?? regionRef.current) : regionRef.current;
        void deleteApiKey(region)
          .then(() => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  hasApiKey: false,
                  notice: `Deleted API key for ${regionLabel(region)} — applies after restart`,
                },
              }),
            );
          })
          .catch((error: unknown) => {
            setOverlay((prev) =>
              patchSettingsOverlay({
                prev,
                patch: {
                  notice: `Failed to delete API key: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
              }),
            );
          });
      }}
    />
  );
}
