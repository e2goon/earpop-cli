import { useEffect, useRef, useState } from "react";

import { useInterrupt } from "#/hooks/use-interrupt.js";
import { deleteApiKey, loadApiKey, saveApiKey } from "#/lib/api-key.js";
import {
  DEFAULT_LANGUAGE_HINTS,
  languageHintLabel,
  normalizeLanguageHints,
  type SttLanguage,
} from "#/lib/languages.js";
import { listMicrophones } from "#/lib/microphones.js";
import { regionLabel, resolveRegion } from "#/lib/region.js";
import { loadSettings, saveSettings } from "#/lib/settings.js";
import type { Microphone, SttRegion } from "#/lib/types.js";
import { quit } from "#/app/runtime.js";
import { SettingsScreen } from "#/screens/settings.js";

export function SettingsApp() {
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMicrophone, setCurrentMicrophone] = useState<string | undefined>();
  const [languages, setLanguages] = useState<SttLanguage[]>([...DEFAULT_LANGUAGE_HINTS]);
  const [region, setRegion] = useState<SttRegion | undefined>();
  const [hasApiKey, setHasApiKey] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  const regionRef = useRef<SttRegion>("us");

  useInterrupt(() => quit());

  useEffect(() => {
    void (async () => {
      const [settings, resolved] = await Promise.all([loadSettings(), resolveRegion()]);
      regionRef.current = resolved;
      const [key, found] = await Promise.all([
        loadApiKey(resolved),
        listMicrophones().catch(() => [] as Microphone[]),
      ]);
      setCurrentMicrophone(settings.microphone);
      setLanguages(normalizeLanguageHints(settings.languages));
      setRegion(resolved);
      setHasApiKey(key !== null);
      setMicrophones(found);
      setLoading(false);
    })();
  }, []);

  return (
    <SettingsScreen
      microphones={microphones}
      microphonesLoading={loading}
      currentMicrophone={currentMicrophone}
      languages={languages}
      region={region}
      hasApiKey={hasApiKey}
      notice={notice}
      onPickMicrophone={(name) => {
        void saveSettings({ microphone: name }).then(() => {
          setCurrentMicrophone(name);
          setNotice(`Microphone set to ${name}`);
        });
      }}
      onPickLanguages={(codes) => {
        void saveSettings({ languages: codes }).then(() => {
          setLanguages(codes);
          setNotice(`Languages set to ${languageHintLabel(codes)}`);
        });
      }}
      onPickRegion={(next) => {
        void saveSettings({ region: next }).then(async () => {
          regionRef.current = next;
          setRegion(next);
          const key = await loadApiKey(next);
          setHasApiKey(key !== null);
          setNotice(
            `Region set to ${regionLabel(next)}${
              key === null ? " — register an API key for this region" : ""
            }`,
          );
        });
      }}
      onChangeApiKey={(key) => {
        void saveApiKey({ key, region: regionRef.current })
          .then(() => {
            setHasApiKey(true);
            setNotice(`Saved API key for ${regionLabel(regionRef.current)}`);
          })
          .catch((error: unknown) => {
            setNotice(
              `Failed to save API key: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      }}
      onDeleteApiKey={() => {
        void deleteApiKey(regionRef.current).then(() => {
          setHasApiKey(false);
          setNotice(`Deleted API key for ${regionLabel(regionRef.current)}`);
        });
      }}
      onExit={() => {
        quit();
      }}
    />
  );
}
