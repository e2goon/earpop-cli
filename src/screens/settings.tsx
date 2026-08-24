import { PasswordInput, Select } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useState } from "react";

import { LanguageSelect } from "#/components/language-select.js";
import { MicrophoneSelect } from "#/components/microphone-select.js";
import { languageHintLabel, type SttLanguage } from "#/lib/languages.js";
import type { Microphone, SttRegion } from "#/lib/types.js";

export interface SettingsScreenProps {
  microphones: Microphone[];
  microphonesLoading: boolean;
  currentMicrophone?: string;
  region?: SttRegion;
  languages: SttLanguage[];
  hasApiKey: boolean;
  notice?: string;
  /** Footer hint for ESC on the menu. Default: "ESC exit". */
  exitLabel?: string;
  onPickMicrophone: (name: string) => void;
  onPickRegion?: (region: SttRegion) => void;
  onPickLanguages: (codes: SttLanguage[]) => void;
  onChangeApiKey: (key: string) => void;
  onDeleteApiKey: () => void;
  onExit: () => void;
}

type MenuItem = "microphone" | "region" | "languages" | "api-key" | "api-key-delete" | "exit";
type View = "menu" | Exclude<MenuItem, "exit"> | "api-key-delete-confirm";

export function SettingsScreen(props: SettingsScreenProps) {
  const [view, setView] = useState<View>("menu");

  const options = buildMenuOptions({
    hasApiKey: props.hasApiKey,
    hasRegion: props.onPickRegion !== undefined,
  });

  useInput((_input, key) => {
    if (!key.escape) return;
    if (view === "microphone" || view === "languages") return;
    if (view !== "menu") setView("menu");
    else props.onExit();
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Settings</Text>

      {props.notice !== undefined && view === "menu" && <Text color="green">{props.notice}</Text>}

      {view === "menu" && (
        <>
          {!props.hasApiKey && <Text dimColor>No saved key</Text>}
          <Text dimColor>Languages: {languageHintLabel(props.languages)}</Text>
          <Select
            options={options}
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
          current={props.languages}
          onPick={(codes) => {
            props.onPickLanguages(codes);
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
            options={[
              {
                label: `United States (us)${(props.region ?? "us") === "us" ? " ✔ current" : ""}`,
                value: "us",
              },
              { label: `Europe (eu)${props.region === "eu" ? " ✔ current" : ""}`, value: "eu" },
              {
                label: `Japan / Tokyo (jp)${props.region === "jp" ? " ✔ current" : ""}`,
                value: "jp",
              },
            ]}
            onChange={(value) => {
              props.onPickRegion?.(value as SttRegion);
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
        <DeleteConfirm
          onConfirm={() => {
            props.onDeleteApiKey();
            setView("menu");
          }}
          onCancel={() => setView("menu")}
        />
      )}
    </Box>
  );
}

function buildMenuOptions({ hasApiKey, hasRegion }: { hasApiKey: boolean; hasRegion: boolean }) {
  const menuOptions: Array<{ label: string; value: MenuItem }> = [
    { label: "Choose microphone", value: "microphone" },
    { label: "Choose languages", value: "languages" },
    ...(hasRegion ? [{ label: "Choose region", value: "region" as MenuItem }] : []),
    { label: "Change API key", value: "api-key" },
  ];
  if (hasApiKey) {
    menuOptions.push({ label: "Delete API key", value: "api-key-delete" });
  }
  menuOptions.push({ label: "Exit", value: "exit" });
  return menuOptions;
}

function DeleteConfirm(props: { onConfirm: () => void; onCancel: () => void }) {
  useInput((input) => {
    if (input === "y") props.onConfirm();
    if (input === "n") props.onCancel();
  });
  return (
    <Text color="red">
      Delete the saved API key? You will need to enter it again next run (y/n)
    </Text>
  );
}
