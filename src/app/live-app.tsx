import { Text, Box, useInput } from "ink";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useAlternateScreen } from "#/hooks/use-alternate-screen.js";
import { useInterrupt } from "#/hooks/use-interrupt.js";
import {
  createTranscription,
  type TranscriptionController,
  type TranscriptionSnapshot,
} from "#/lib/transcription.js";
import { copyWithFallback } from "#/lib/clipboard.js";
import { deleteApiKey, loadApiKey, saveApiKey } from "#/lib/api-key.js";
import { errorMessage } from "#/lib/errors.js";
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
import type { CliSettings, Microphone, SttRegion } from "#/lib/types.js";
import { quit } from "#/app/runtime.js";
import { printSessionEnd } from "#/app/session-end.js";
import { CaptionScreen, type CaptionOverlay } from "#/screens/caption.js";
import { KeySetup } from "#/screens/key-setup.js";
import { MicrophoneSelect } from "#/components/microphone-select.js";
import { RegionSelect } from "#/screens/region-select.js";

type LivePhase = "boot" | "region-select" | "key-setup" | "mic-select" | "live" | "ended" | "fatal";

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

type SettingsOverlay = Extract<CaptionOverlay, { kind: "settings" }>;

export function LiveApp() {
  const [phase, setPhase] = useState<LivePhase>("boot");
  const [verifying, setVerifying] = useState(false);
  const [keyError, setKeyError] = useState<string | undefined>();
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [micsLoading, setMicsLoading] = useState(true);
  const [micNotice, setMicNotice] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<TranscriptionSnapshot | null>(null);
  const [overlay, setOverlay] = useState<CaptionOverlay>(CLOSED_OVERLAY);
  const [journalPath, setJournalPath] = useState<string | null>(null);
  const [fatalMessage, setFatalMessage] = useState("Unknown error");
  const [region, setRegion] = useState<SttRegion>("us");

  const controllerRef = useRef<TranscriptionController | null>(null);
  const languageHintsRef = useRef<SttLanguage[]>([...DEFAULT_LANGUAGE_HINTS]);
  // Invalidate in-flight overlay loads when the overlay closes or is replaced.
  const overlayEpochRef = useRef(0);

  const finish = () => {
    quit(journalPath === null ? undefined : () => printSessionEnd(journalPath));
  };

  // First Esc / Ctrl+C: stop session, keep path on screen. Second press: exit.
  const sessionEndedRef = useRef(false);
  const exitStartedRef = useRef(false);

  const copyJournalPath = () => {
    if (journalPath !== null) copyWithFallback(journalPath);
  };

  const closeOverlay = () => {
    overlayEpochRef.current += 1;
    setOverlay(CLOSED_OVERLAY);
  };

  const failFatal = (message: string) => {
    setFatalMessage(message);
    setPhase("fatal");
  };

  const requestExit = () => {
    if (sessionEndedRef.current || exitStartedRef.current || phase === "fatal") {
      if (exitStartedRef.current) {
        // Prefer exit over a stuck stop().
        void controllerRef.current?.stop();
        process.exit(130);
      }
      exitStartedRef.current = true;
      finish();
      return;
    }

    sessionEndedRef.current = true;
    copyJournalPath();
    closeOverlay();
    setPhase("ended");

    const controller = controllerRef.current;
    if (controller === null) {
      finish();
      return;
    }
    // Stay on the ended screen until the next Esc / Ctrl+C.
    void controller.stop().catch(() => {});
  };
  useInterrupt(requestExit);

  async function startLive({
    region: liveRegion,
    apiKey,
    deviceName,
  }: {
    region: SttRegion;
    apiKey: string;
    deviceName?: string;
  }) {
    try {
      const journal = openJournal(STT_MODEL);
      setJournalPath(journal.path);

      const controller = createTranscription({
        journal,
        apiKey,
        device: deviceName,
        clientReferenceId: journal.id,
        region: liveRegion,
        languageHints: languageHintsRef.current,
        onSnapshot: setSnapshot,
        onFatal: failFatal,
      });
      controllerRef.current = controller;
      await controller.start();
      setPhase("live");
    } catch (error) {
      failFatal(errorMessage(error));
    }
  }

  async function chooseInitialMicrophone(savedName: string | null) {
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
      setMicNotice(errorMessage(error));
    }
    setMicsLoading(false);
  }

  const boot = useEffectEvent(
    async ({ settings, isCancelled }: { settings: CliSettings; isCancelled: () => boolean }) => {
      const savedRegion = resolveRegion(settings);
      setRegion(savedRegion);
      languageHintsRef.current = normalizeLanguageHints(settings.languages);
      const apiKey = await loadApiKey(savedRegion);
      if (isCancelled()) return;
      if (apiKey === null) {
        setPhase("region-select");
        return;
      }
      const savedName = settings.microphone ?? null;
      if (savedName === null) {
        await chooseInitialMicrophone(null);
        return;
      }
      await startLive({ region: savedRegion, apiKey, deviceName: savedName });
    },
  );

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((settings) => boot({ settings, isCancelled: () => cancelled }));
    return () => {
      cancelled = true;
    };
  }, []);

  useAlternateScreen(phase === "live" || phase === "ended" || phase === "boot");

  if (phase === "boot") {
    return <Text>Preparing…</Text>;
  }

  if (phase === "region-select") {
    return (
      <RegionSelect
        onPick={(next) => {
          setRegion(next);
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
        regionLabel={regionLabel(region)}
        onSubmit={(key) => {
          setVerifying(true);
          setKeyError(undefined);
          void (async () => {
            const result = await verifyApiKey({ key: key.trim(), region });
            if (!result.ok) {
              setKeyError(
                `${result.message}\nIf the region is wrong, press ESC to quit, then change it with 'earpop settings'.`,
              );
              setVerifying(false);
              return;
            }
            try {
              await saveApiKey({ key, region });
            } catch (error) {
              setKeyError(errorMessage(error));
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
                const apiKey = await loadApiKey(region);
                if (apiKey === null) {
                  setPhase("region-select");
                  return;
                }
                await startLive({ region, apiKey, deviceName: name });
              })();
            }}
          />
        )}
      </Box>
    );
  }

  if (phase === "fatal") {
    return <FatalScreen message={fatalMessage} onQuit={requestExit} />;
  }

  if (snapshot === null) {
    return <Text>Preparing…</Text>;
  }

  const overlayRegion = overlay.kind === "settings" ? (overlay.region ?? region) : region;
  const patchSettings = (patch: Partial<SettingsOverlay>) =>
    setOverlay((prev) => (prev.kind === "settings" ? { ...prev, ...patch } : prev));
  const failSettings = (action: string) => (error: unknown) =>
    patchSettings({ notice: `Failed to ${action}: ${errorMessage(error)}` });

  return (
    <CaptionScreen
      {...snapshot}
      journalPath={journalPath ?? undefined}
      ended={phase === "ended"}
      overlay={overlay}
      getHistory={() => controllerRef.current?.getHistory() ?? []}
      onTogglePause={() => {
        // Pause copies the transcript path to the clipboard on enter.
        if (snapshot.state !== "paused") copyJournalPath();
        void controllerRef.current?.togglePause();
      }}
      onQuit={requestExit}
      onOpenMicrophones={() => {
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
              error: errorMessage(error),
            });
          });
      }}
      onOpenSettings={() => {
        const epoch = ++overlayEpochRef.current;
        setOverlay({
          kind: "settings",
          microphones: [],
          microphonesLoading: true,
          currentMicrophone: snapshot.device,
          region,
          languages: languageHintsRef.current,
          hasApiKey: true,
        });
        void (async () => {
          const microphonesLoad = listMicrophones().catch(() => [] as Microphone[]);
          const settings = await loadSettings();
          const resolved = resolveRegion(settings);
          const [key, found] = await Promise.all([loadApiKey(resolved), microphonesLoad]);
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
        closeOverlay();
        void controllerRef.current?.switchMicrophone(name);
      }}
      onCloseOverlay={closeOverlay}
      onSettingsPickMicrophone={(name) => {
        void controllerRef.current
          ?.switchMicrophone(name)
          .then(() =>
            patchSettings({ currentMicrophone: name, notice: `Microphone set to ${name}` }),
          )
          .catch(failSettings("set microphone"));
      }}
      onSettingsPickLanguages={(codes) => {
        languageHintsRef.current = codes;
        void controllerRef.current
          ?.setLanguageHints(codes)
          .then(() =>
            patchSettings({
              languages: codes,
              notice: `Languages set to ${languageHintLabel(codes)}`,
            }),
          )
          .catch((error: unknown) =>
            patchSettings({
              languages: codes,
              notice: `Failed to set languages: ${errorMessage(error)}`,
            }),
          );
      }}
      onSettingsPickRegion={(next) => {
        void saveSettings({ region: next })
          .then(async () => {
            const key = await loadApiKey(next);
            patchSettings({
              region: next,
              hasApiKey: key !== null,
              notice: `Region set to ${regionLabel(next)} — applies after restart${
                key === null ? " (register an API key for this region)" : ""
              }`,
            });
          })
          .catch(failSettings("save region"));
      }}
      onSettingsChangeApiKey={(key) => {
        void saveApiKey({ key, region: overlayRegion })
          .then(() =>
            patchSettings({
              hasApiKey: true,
              notice: `Saved API key for ${regionLabel(overlayRegion)} — applies after restart`,
            }),
          )
          .catch(failSettings("save API key"));
      }}
      onSettingsDeleteApiKey={() => {
        void deleteApiKey(overlayRegion)
          .then(() =>
            patchSettings({
              hasApiKey: false,
              notice: `Deleted API key for ${regionLabel(overlayRegion)} — applies after restart`,
            }),
          )
          .catch(failSettings("delete API key"));
      }}
    />
  );
}
