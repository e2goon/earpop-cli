import { ConfirmInput, PasswordInput } from "@inkjs/ui";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useState } from "react";

import { LanguageSelect } from "#/components/language-select.js";
import { listHeight, menuGap } from "#/components/list-height.js";
import { MicrophoneSelect } from "#/components/microphone-select.js";
import { Select } from "#/components/select.js";
import { languageHintLabel, translationLabel, type SttLanguage } from "#/lib/languages.js";
import { DEFAULT_REGION, REGIONS } from "#/lib/region.js";
import type { Microphone, SttRegion } from "#/lib/types.js";

export interface SettingsScreenProps {
  microphones: Microphone[];
  microphonesLoading: boolean;
  currentMicrophone?: string;
  region?: SttRegion;
  languages: SttLanguage[];
  translation: SttLanguage[];
  hasApiKey: boolean;
  notice?: string;
  /** Rows the settings may use; defaults to the terminal height. */
  rows?: number;
  /** Footer hint for ESC on the menu. Default: "ESC exit". */
  exitLabel?: string;
  onPickMicrophone: (name: string) => void;
  onPickRegion: (region: SttRegion) => void;
  onPickLanguages: (codes: SttLanguage[]) => void;
  onPickTranslation: (codes: SttLanguage[]) => void;
  onChangeApiKey: (key: string) => void;
  onDeleteApiKey: () => void;
  onExit: () => void;
}

type MenuItem =
  | "microphone"
  | "region"
  | "languages"
  | "translation"
  | "api-key"
  | "api-key-delete"
  | "exit";
type View = "menu" | Exclude<MenuItem, "exit"> | "api-key-delete-confirm";

export function SettingsScreen(props: SettingsScreenProps) {
  const [view, setView] = useState<View>("menu");
  const windowRows = useWindowSize().rows;
  const rows = props.rows ?? windowRows;

  const options: Array<{ label: string; value: MenuItem }> = [
    { label: "Choose microphone", value: "microphone" },
    { label: "Choose languages", value: "languages" },
    { label: "Translation", value: "translation" },
    { label: "Choose region", value: "region" },
    { label: "Change API key", value: "api-key" },
    ...(props.hasApiKey ? [{ label: "Delete API key", value: "api-key-delete" as const }] : []),
    { label: "Exit", value: "exit" },
  ];

  useInput((_input, key) => {
    if (!key.escape) return;
    if (view === "microphone" || view === "languages" || view === "translation") return;
    if (view !== "menu") setView("menu");
    else props.onExit();
  });

  return (
    <Box flexDirection="column" gap={menuGap(rows)}>
      <Text>Settings</Text>

      {props.notice !== undefined && view === "menu" && <Text color="green">{props.notice}</Text>}

      {view === "menu" && (
        <>
          {!props.hasApiKey && <Text dimColor>No saved key</Text>}
          <Text dimColor>Languages: {languageHintLabel(props.languages)}</Text>
          <Text dimColor>Translation: {translationLabel(props.translation)}</Text>
          <Select
            options={options}
            // Title, two status lines, the footer, and a notice take the other rows.
            visibleOptionCount={listHeight({ rows, reserved: 5, max: options.length })}
            onChange={(value) => {
              const item = value as MenuItem;
              if (item === "exit") props.onExit();
              else if (item === "api-key-delete") setView("api-key-delete-confirm");
              else setView(item);
            }}
          />
          <Text dimColor>{props.exitLabel ?? "ESC exit"}</Text>
        </>
      )}

      {view === "microphone" && (
        <MicrophoneSelect
          rows={rows}
          microphones={props.microphones}
          current={props.currentMicrophone}
          loading={props.microphonesLoading}
          onPick={(name) => {
            props.onPickMicrophone(name);
            setView("menu");
          }}
          onCancel={() => setView("menu")}
        />
      )}

      {view === "languages" && (
        <LanguageSelect
          rows={rows}
          current={props.languages}
          onPick={(codes) => {
            props.onPickLanguages(codes);
            setView("menu");
          }}
          onCancel={() => setView("menu")}
        />
      )}

      {view === "translation" && (
        <LanguageSelect
          rows={rows}
          current={props.translation}
          help="Pick one language to translate everything into it, two to translate between them, or none to turn translation off."
          allowEmpty
          max={2}
          onPick={(codes) => {
            props.onPickTranslation(codes);
            setView("menu");
          }}
          onCancel={() => setView("menu")}
        />
      )}

      {view === "region" && (
        <Box flexDirection="column">
          <Text dimColor>
            Pick the region for transcription requests (must match the project that issued your key)
          </Text>
          <Select
            options={REGIONS.map((region) => ({
              label: `${region.option}${(props.region ?? DEFAULT_REGION) === region.code ? " ✔ current" : ""}`,
              value: region.code,
            }))}
            onChange={(value) => {
              props.onPickRegion(value as SttRegion);
              setView("menu");
            }}
          />
        </Box>
      )}

      {view === "api-key" && (
        <Box flexDirection="column">
          <Text dimColor>Paste a new API key and press Enter (ESC to go back)</Text>
          <PasswordInput
            placeholder="New API key"
            onSubmit={(key) => {
              props.onChangeApiKey(key);
              setView("menu");
            }}
          />
        </Box>
      )}

      {view === "api-key-delete-confirm" && (
        <Box gap={1}>
          <Text color="red">
            Delete the saved API key? You will need to enter it again next run
          </Text>
          <ConfirmInput
            defaultChoice="cancel"
            onConfirm={() => {
              props.onDeleteApiKey();
              setView("menu");
            }}
            onCancel={() => setView("menu")}
          />
        </Box>
      )}
    </Box>
  );
}
