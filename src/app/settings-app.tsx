import { useEffect, useRef, useState } from "react";

import { useInterrupt } from "#/hooks/use-interrupt.js";
import { deleteApiKey, loadApiKey, saveApiKey } from "#/lib/api-key.js";
import { errorMessage } from "#/lib/errors.js";
import {
  defaultLanguageHints,
  languageHintLabel,
  normalizeLanguageHints,
  translationLabel,
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
  const [languages, setLanguages] = useState<SttLanguage[]>(defaultLanguageHints);
  const [translation, setTranslation] = useState<SttLanguage[]>([]);
  const [region, setRegion] = useState<SttRegion | undefined>();
  const [hasApiKey, setHasApiKey] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  const regionRef = useRef<SttRegion>("us");

  useInterrupt(() => quit());

  useEffect(() => {
    void (async () => {
      const microphonesLoad = listMicrophones().catch(() => [] as Microphone[]);
      const settings = await loadSettings();
      const resolved = resolveRegion(settings);
      regionRef.current = resolved;
      const [key, found] = await Promise.all([loadApiKey(resolved), microphonesLoad]);
      setCurrentMicrophone(settings.microphone);
      setLanguages(normalizeLanguageHints(settings.languages));
      setTranslation(settings.translation ?? []);
      setRegion(resolved);
      setHasApiKey(key !== null);
      setMicrophones(found);
      setLoading(false);
    })().catch((error: unknown) => {
      setNotice(`Failed to load settings: ${errorMessage(error)}`);
      setLoading(false);
    });
  }, []);

  const failWith = (action: string) => (error: unknown) =>
    setNotice(`Failed to ${action}: ${errorMessage(error)}`);

  return (
    <SettingsScreen
      microphones={microphones}
      microphonesLoading={loading}
      currentMicrophone={currentMicrophone}
      languages={languages}
      translation={translation}
      region={region}
      hasApiKey={hasApiKey}
      notice={notice}
      onPickMicrophone={(name) => {
        void saveSettings({ microphone: name })
          .then(() => {
            setCurrentMicrophone(name);
            setNotice(`Microphone set to ${name}`);
          })
          .catch(failWith("set microphone"));
      }}
      onPickLanguages={(codes) => {
        void saveSettings({ languages: codes })
          .then(() => {
            setLanguages(codes);
            setNotice(`Languages set to ${languageHintLabel(codes)}`);
          })
          .catch(failWith("set languages"));
      }}
      onPickTranslation={(codes) => {
        void saveSettings({ translation: codes })
          .then(() => {
            setTranslation(codes);
            setNotice(`Translation: ${translationLabel(codes)}`);
          })
          .catch(failWith("set translation"));
      }}
      onPickRegion={(next) => {
        void saveSettings({ region: next })
          .then(async () => {
            regionRef.current = next;
            setRegion(next);
            const key = await loadApiKey(next);
            setHasApiKey(key !== null);
            setNotice(
              `Region set to ${regionLabel(next)}${
                key === null ? " (register an API key for this region)" : ""
              }`,
            );
          })
          .catch(failWith("save region"));
      }}
      onChangeApiKey={(key) => {
        void saveApiKey({ key, region: regionRef.current })
          .then(() => {
            setHasApiKey(true);
            setNotice(`Saved API key for ${regionLabel(regionRef.current)}`);
          })
          .catch(failWith("save API key"));
      }}
      onDeleteApiKey={() => {
        void deleteApiKey(regionRef.current)
          .then(() => {
            setHasApiKey(false);
            setNotice(`Deleted API key for ${regionLabel(regionRef.current)}`);
          })
          .catch(failWith("delete API key"));
      }}
      onExit={() => {
        quit();
      }}
    />
  );
}
