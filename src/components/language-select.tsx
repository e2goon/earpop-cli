import { MultiSelect } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useState } from "react";

import {
  LANGUAGE_SELECT_OPTIONS,
  normalizeLanguageHints,
  type SttLanguage,
} from "#/lib/languages.js";

export interface LanguageSelectProps {
  current: SttLanguage[];
  onPick: (codes: SttLanguage[]) => void;
  onCancel: () => void;
}

export function LanguageSelect(props: LanguageSelectProps) {
  const [error, setError] = useState<string | undefined>();

  useInput((_input, key) => {
    if (key.escape) props.onCancel();
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Space toggles, Enter saves. A single language uses strict restriction.</Text>
      {error !== undefined && <Text color="red">{error}</Text>}
      <MultiSelect
        options={LANGUAGE_SELECT_OPTIONS}
        defaultValue={props.current}
        visibleOptionCount={12}
        onSubmit={(values) => {
          if (values.length === 0) {
            setError("Select at least one language");
            return;
          }
          props.onPick(normalizeLanguageHints(values));
        }}
      />
      <Text dimColor>ESC cancel</Text>
    </Box>
  );
}
