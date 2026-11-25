import { Text, Box, useInput } from "ink";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useInterrupt } from "#/hooks/use-interrupt.js";
import { utteranceMatchesFilter, type CommittedUtterance } from "#/lib/caption-layout.js";
import {
  createTranscription,
  type TranscriptionController,
  type TranscriptionSnapshot,
} from "#/lib/transcription.js";
import { deleteApiKey, loadApiKey, saveApiKey } from "#/lib/api-key.js";
import { errorMessage } from "#/lib/errors.js";
import { openJournal } from "#/lib/journal.js";
import {
  languageHintLabel,
  normalizeLanguageHints,
  translationLabel,
  type SttLanguage,
} from "#/lib/languages.js";
import { listMicrophones } from "#/lib/microphones.js";
import { regionLabel, resolveRegion } from "#/lib/region.js";
import { fitTerms, saveSettings, loadSettings } from "#/lib/settings.js";
import { STT_MODEL } from "#/lib/soniox.js";
import { verifyApiKey } from "#/lib/verify-key.js";
import type { CliSettings, Journal, Microphone, SttRegion } from "#/lib/types.js";
import { quit } from "#/app/runtime.js";
import { printSessionEnd } from "#/app/session-end.js";
import { CaptionScreen, type CaptionOverlay } from "#/screens/caption.js";
import { KeySetup } from "#/screens/key-setup.js";
import { LanguageSelect } from "#/components/language-select.js";
import { MicrophoneSelect } from "#/components/microphone-select.js";
import { RegionSelect } from "#/screens/region-select.js";

type LivePhase =
  | "boot"
  | "region-select"
  | "key-setup"
  | "mic-select"
  | "language-select"
  | "live"
  | "ended"
  | "fatal";

type LiveStart = { region: SttRegion; apiKey: string; deviceName?: string };

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

export function LiveApp(props: { languages?: SttLanguage[]; translation?: SttLanguage[] }) {
  const [phase, setPhase] = useState<LivePhase>("boot");
  const [verifying, setVerifying] = useState(false);
  const [keyError, setKeyError] = useState<string | undefined>();
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [micsLoading, setMicsLoading] = useState(true);
  const [micNotice, setMicNotice] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<TranscriptionSnapshot | null>(null);
  const [committed, setCommitted] = useState<CommittedUtterance[]>([]);
  const [overlay, setOverlay] = useState<CaptionOverlay>(CLOSED_OVERLAY);
  const [journalPath, setJournalPath] = useState<string | null>(null);
  const [fatalMessage, setFatalMessage] = useState("Unknown error");
  const [region, setRegion] = useState<SttRegion>("us");
  const [finishing, setFinishing] = useState(false);
  const [warning, setWarning] = useState<string | undefined>();

  const controllerRef = useRef<TranscriptionController | null>(null);
  const journalRef = useRef<Journal | null>(null);
  // Session options read once at boot; the controller owns them afterwards (see snapshot).
  const languageHintsRef = useRef<SttLanguage[]>([]);
  const termsRef = useRef<string[]>([]);
  const translationRef = useRef<SttLanguage[]>([]);
  // Invalidate in-flight overlay loads when the overlay closes or is replaced.
  const overlayEpochRef = useRef(0);
  const filterRef = useRef<{ speakers: ReadonlySet<string>; language?: string }>({
    speakers: new Set(),
  });

  const finish = () => {
    const journal = journalRef.current;
    const shouldPrint =
      journalPath !== null &&
      journal !== null &&
      (journal.hasWritten || journal.writeError !== undefined);
    quit(
      shouldPrint
        ? () => printSessionEnd({ path: journalPath, writeError: journal.writeError })
        : undefined,
    );
  };

  // Ctrl+C, or ESC confirmed on the caption screen, ends the session and keeps the path on screen.
  // The next press exits once the transcript is finalized; one more exits immediately.
  const sessionEndedRef = useRef(false);
  const exitStartedRef = useRef(false);

  const closeOverlay = () => {
    overlayEpochRef.current += 1;
    setOverlay(CLOSED_OVERLAY);
  };

  const failFatal = (message: string) => {
    setFatalMessage(message);
    setPhase("fatal");
  };

  const requestExit = () => {
    if (exitStartedRef.current) process.exit(130);
    if (sessionEndedRef.current || phase === "fatal") {
      exitStartedRef.current = true;
      setFinishing(true);
      void Promise.resolve(controllerRef.current?.stop())
        .catch(() => {})
        // Yield one tick so React/Ink flushes any final <Static> commit before unmount.
        .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
        .then(finish);
      return;
    }

    sessionEndedRef.current = true;
    closeOverlay();
    setPhase("ended");

    if (controllerRef.current === null) {
      finish();
      return;
    }
    void controllerRef.current.stop().catch(() => {});
  };
  useInterrupt(requestExit);

  // First run: ask which languages people speak before streaming, since the system locale is
  // often English even for people who talk in another language.
  const askLanguagesRef = useRef(false);
  const [suggestedLanguages, setSuggestedLanguages] = useState<SttLanguage[]>([]);
  const [languageStart, setLanguageStart] = useState<LiveStart | null>(null);

  async function startLive(start: LiveStart) {
    if (askLanguagesRef.current) {
      setLanguageStart(start);
      setPhase("language-select");
      return;
    }
    const { region: liveRegion, apiKey, deviceName } = start;
    try {
      const journal = openJournal({ model: STT_MODEL, onWriteError: setWarning });
      journalRef.current = journal;
      setJournalPath(journal.path);

      const controller = createTranscription({
        journal,
        apiKey,
        device: deviceName,
        clientReferenceId: journal.id,
        region: liveRegion,
        languageHints: languageHintsRef.current,
        terms: termsRef.current,
        translation: translationRef.current,
        onCommit: (items) => {
          const { speakers, language } = filterRef.current;
          const matched = items.filter((utterance) =>
            utteranceMatchesFilter({
              utterance,
              focusedSpeakers: speakers,
              focusedLanguage: language,
            }),
          );
          if (matched.length > 0) {
            setCommitted((prev) => [...prev, ...matched]);
          }
        },
        onSnapshot: setSnapshot,
        onFatal: failFatal,
      });
      controllerRef.current = controller;
      await controller.start();
      if (!sessionEndedRef.current) setPhase("live");
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

  const boot = useEffectEvent(async (settings: CliSettings) => {
    const savedRegion = resolveRegion(settings);
    setRegion(savedRegion);
    // --lang and --translate apply to this run only; picking them in settings still saves them.
    languageHintsRef.current = props.languages ?? normalizeLanguageHints(settings.languages);
    askLanguagesRef.current = props.languages === undefined && settings.languages === undefined;
    setSuggestedLanguages(languageHintsRef.current);
    termsRef.current = fitTerms(settings.terms ?? []);
    translationRef.current = props.translation ?? settings.translation ?? [];
    const apiKey = await loadApiKey(savedRegion);
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
  });

  useEffect(() => {
    void loadSettings()
      .then((settings) => boot(settings))
      .catch((error: unknown) => failFatal(errorMessage(error)));
  }, []);

  if (phase === "boot") {
    return <Text>Preparing</Text>;
  }

  if (phase === "region-select") {
    return (
      <RegionSelect
        onPick={(next) => {
          setRegion(next);
          void saveSettings({ region: next }).catch((error: unknown) =>
            setWarning(`Could not save region: ${errorMessage(error)}`),
          );
          setPhase("key-setup");
        }}
        onCancel={requestExit}
      />
    );
  }

  if (phase === "key-setup") {
    return (
      <KeySetup
        error={keyError}
        verifying={verifying}
        regionLabel={regionLabel(region)}
        onBack={() => {
          setKeyError(undefined);
          setPhase("region-select");
        }}
        onSubmit={(key) => {
          setVerifying(true);
          setKeyError(undefined);
          void (async () => {
            try {
              const result = await verifyApiKey({ key: key.trim(), region });
              if (!result.ok) {
                setKeyError(
                  `${result.message}\nIf the region is wrong, press ESC to pick another region.`,
                );
                setVerifying(false);
                return;
              }
              await saveApiKey({ key, region });
              setVerifying(false);
              const settings = await loadSettings();
              await chooseInitialMicrophone(settings.microphone ?? null);
            } catch (error) {
              setKeyError(errorMessage(error));
              setVerifying(false);
            }
          })();
        }}
      />
    );
  }

  if (phase === "mic-select") {
    return (
      <Box flexDirection="column">
        <Text>Choose a microphone</Text>
        {micNotice !== undefined && <Text color="yellow">{micNotice}</Text>}
        <MicrophoneSelect
          microphones={microphones}
          loading={micsLoading}
          cancelLabel="ESC quit"
          onCancel={requestExit}
          onPick={(name) => {
            setPhase("boot");
            void (async () => {
              await saveSettings({ microphone: name });
              const apiKey = await loadApiKey(region);
              if (apiKey === null) {
                setPhase("region-select");
                return;
              }
              await startLive({ region, apiKey, deviceName: name });
            })().catch((error: unknown) => failFatal(errorMessage(error)));
          }}
        />
      </Box>
    );
  }

  if (phase === "language-select" && languageStart !== null) {
    return (
      <Box flexDirection="column">
        <Text>Which languages will people speak?</Text>
        <LanguageSelect
          current={suggestedLanguages}
          help="Pick every language you expect; one language keeps the output in it. Press s during a session to change this."
          cancelLabel="ESC quit"
          onCancel={requestExit}
          onPick={(codes) => {
            languageHintsRef.current = codes;
            askLanguagesRef.current = false;
            setPhase("boot");
            void saveSettings({ languages: codes })
              .catch((error: unknown) =>
                setWarning(
                  `Could not save languages (${errorMessage(error)}); earpop will ask again next time`,
                ),
              )
              .then(() => startLive(languageStart));
          }}
        />
      </Box>
    );
  }

  if (phase === "fatal") {
    return <FatalScreen message={fatalMessage} onQuit={requestExit} />;
  }

  if (snapshot === null) {
    return <Text>Preparing</Text>;
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
      warning={warning}
      ended={phase === "ended"}
      finishing={finishing}
      overlay={overlay}
      committed={committed}
      onFilterChange={(filter) => {
        filterRef.current = filter;
      }}
      getHeardLanguages={() => controllerRef.current?.getHeardLanguages() ?? []}
      onTogglePause={() => {
        void controllerRef.current?.togglePause().catch((error: unknown) => {
          setWarning(`Failed to toggle pause: ${errorMessage(error)}`);
        });
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
          languages: snapshot.languages,
          translation: snapshot.translation,
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
            // The controller owns languages and translation while connected.
            languages: snapshot.languages,
            translation: snapshot.translation,
            hasApiKey: key !== null,
          });
        })().catch((error: unknown) => {
          if (epoch !== overlayEpochRef.current) return;
          patchSettings({
            microphonesLoading: false,
            notice: `Failed to load settings: ${errorMessage(error)}`,
          });
        });
      }}
      onPickMicrophone={(name) => {
        closeOverlay();
        void controllerRef.current?.switchMicrophone(name).catch(() => {});
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
      onSettingsPickTranslation={(codes) => {
        void controllerRef.current
          ?.setTranslation(codes)
          .then(() =>
            patchSettings({
              translation: codes,
              notice: `Translation: ${translationLabel(codes)}`,
            }),
          )
          .catch((error: unknown) =>
            patchSettings({
              translation: codes,
              notice: `Failed to set translation: ${errorMessage(error)}`,
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
              notice: `Region set to ${regionLabel(next)} (applies after restart${
                key === null ? ", register an API key for this region" : ""
              })`,
            });
          })
          .catch(failSettings("save region"));
      }}
      onSettingsChangeApiKey={(key) => {
        void saveApiKey({ key, region: overlayRegion })
          .then(() =>
            patchSettings({
              hasApiKey: true,
              notice: `Saved API key for ${regionLabel(overlayRegion)} (applies after restart)`,
            }),
          )
          .catch(failSettings("save API key"));
      }}
      onSettingsDeleteApiKey={() => {
        void deleteApiKey(overlayRegion)
          .then(() =>
            patchSettings({
              hasApiKey: false,
              notice: `Deleted API key for ${regionLabel(overlayRegion)} (applies after restart)`,
            }),
          )
          .catch(failSettings("delete API key"));
      }}
    />
  );
}
