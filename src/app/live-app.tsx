import { Text, Box } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAlternateScreen } from "#/hooks/use-alternate-screen.js";
import { useInterrupt } from "#/hooks/use-interrupt.js";
import {
  createTranscription,
  type TranscriptionController,
  type TranscriptionSnapshot,
} from "#/lib/transcription.js";
import { copyToClipboard, osc52Sequence } from "#/lib/clipboard.js";
import { loadApiKey, saveApiKey } from "#/lib/api-key.js";
import { openJournal } from "#/lib/journal.js";
import { listMicrophones } from "#/lib/microphones.js";
import { resolveRegion } from "#/lib/region.js";
import { saveSettings, loadSettings } from "#/lib/settings.js";
import { STT_MODEL } from "#/lib/soniox.js";
import { verifyApiKey } from "#/lib/verify-key.js";
import type { Microphone, SttRegion } from "#/lib/types.js";
import { quit } from "#/app/runtime.js";
import { printSessionEnd } from "#/app/session-end.js";
import { CaptionScreen } from "#/screens/caption.js";
import { KeySetup } from "#/screens/key-setup.js";
import { MicrophoneSelect } from "#/components/microphone-select.js";
import { RegionSelect } from "#/screens/region-select.js";

type LivePhase =
  | "boot"
  | "region-select"
  | "key-setup"
  | "mic-select"
  | "live"
  | "cleanup"
  | "fatal";

const STOP_TIMEOUT_MS = 3_000;

interface MicOverlay {
  open: boolean;
  microphones: Microphone[];
  loading: boolean;
  error?: string;
}

const CLOSED_OVERLAY: MicOverlay = { open: false, microphones: [], loading: false };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function LiveApp() {
  const [phase, setPhase] = useState<LivePhase>("boot");
  const [verifying, setVerifying] = useState(false);
  const [keyError, setKeyError] = useState<string | undefined>();
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [micsLoading, setMicsLoading] = useState(true);
  const [micNotice, setMicNotice] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<TranscriptionSnapshot | null>(null);
  const [overlay, setOverlay] = useState<MicOverlay>(CLOSED_OVERLAY);

  const controllerRef = useRef<TranscriptionController | null>(null);
  const journalPathRef = useRef<string | null>(null);
  const fatalMessageRef = useRef<string | null>(null);
  const regionRef = useRef<SttRegion>("us");

  const finish = useCallback(() => {
    const path = journalPathRef.current;
    quit(path === null ? undefined : () => printSessionEnd(path));
  }, []);

  // First Ctrl+C / quit runs orderly cleanup; a second press force-exits immediately.
  const exitStartedRef = useRef(false);
  const requestExit = useCallback(() => {
    if (exitStartedRef.current) {
      try {
        void controllerRef.current?.stop();
      } catch {
        // Prefer exit over a stuck stop().
      }
      process.exit(130);
    }
    exitStartedRef.current = true;
    const controller = controllerRef.current;
    if (controller === null) {
      process.exit(0);
    }
    setPhase("cleanup");
    // Race stop() so a hung session finish cannot block exit forever.
    void Promise.race([controller.stop(), delay(STOP_TIMEOUT_MS)]).then(finish);
  }, [finish]);
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
    active: phase === "live" || phase === "cleanup" || phase === "boot",
    onRepaint: repaint,
  });

  if (phase === "boot") {
    return <Text>Preparing…</Text>;
  }

  if (phase === "cleanup") {
    return <Text>Cleaning up…</Text>;
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
        regionLabel={
          regionRef.current === "us"
            ? "United States"
            : regionRef.current === "eu"
              ? "Europe"
              : "Japan (Tokyo)"
        }
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
                `${result.message}\nIf the region is wrong, press s to quit, then change it with 'earpop settings'.`,
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
      <Box flexDirection="column">
        <Text color="red">
          {`Cannot continue transcription: ${fatalMessageRef.current ?? "Unknown error"}`}
        </Text>
        <Text dimColor>Press s to quit, fix the issue, then run earpop again</Text>
      </Box>
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
      microphoneOverlay={overlay}
      onTogglePause={() => {
        // Pause copies the transcript path to the clipboard on enter.
        if (snapshot.state !== "paused" && journalPathRef.current !== null) {
          const copied = copyToClipboard(journalPathRef.current);
          if (!copied) process.stdout.write(osc52Sequence(journalPathRef.current));
        }
        void controllerRef.current?.togglePause();
      }}
      onQuit={requestExit}
      onOpenMicrophones={() => {
        setOverlay({ open: true, microphones: [], loading: true });
        void listMicrophones()
          .then((found) => {
            setOverlay({ open: true, microphones: found, loading: false });
          })
          .catch((error: unknown) => {
            setOverlay({
              open: true,
              microphones: [],
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }}
      onPickMicrophone={(name) => {
        setOverlay(CLOSED_OVERLAY);
        void controllerRef.current?.switchMicrophone(name);
      }}
      onCloseMicrophones={() => {
        setOverlay(CLOSED_OVERLAY);
      }}
    />
  );
}
