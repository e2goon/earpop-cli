import { MultiSelect } from "@inkjs/ui";
import { Box, Text, useInput, useWindowSize } from "ink";

import { listHeight, menuGap } from "#/components/list-height.js";
import { useMemo, useState } from "react";

import {
  languageSelectOptions,
  normalizeLanguageHints,
  type SttLanguage,
} from "#/lib/languages.js";

interface LanguageSelectProps {
  current: SttLanguage[];
  /** Explains what the selection means; defaults to the language hint wording. */
  help?: string;
  /** Allows saving with nothing selected. */
  allowEmpty?: boolean;
  max?: number;
  /** Rows this picker may use; defaults to the terminal height. */
  rows?: number;
  onPick: (codes: SttLanguage[]) => void;
  onCancel: () => void;
}

export function LanguageSelect(props: LanguageSelectProps) {
  const [error, setError] = useState<string | undefined>();
  const windowRows = useWindowSize().rows;
  const rows = props.rows ?? windowRows;
  const [query, setQuery] = useState("");
  // MultiSelect resets to defaultValue when its options change, so carry the selection across filters.
  const [selected, setSelected] = useState<string[]>(props.current);
  // Order once on open so options do not jump while toggling.
  const [allOptions] = useState(() => languageSelectOptions({ selected: props.current }));
  const options = useMemo(() => {
    const needle = query.toLowerCase();
    return needle === ""
      ? allOptions
      : allOptions.filter((option) => option.label.toLowerCase().includes(needle));
  }, [allOptions, query]);

  useInput((input, key) => {
    if (key.escape) {
      if (query !== "") setQuery("");
      else props.onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }
    // Space toggles in MultiSelect; any other printable character narrows the list.
    if (input !== "" && input !== " " && !key.ctrl && !key.meta && /^\P{C}+$/u.test(input)) {
      setQuery((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" gap={menuGap(rows)}>
      <Text dimColor>
        {`Type to search, Space toggles, Enter saves. ${props.help ?? "A single language uses strict restriction."}`}
      </Text>
      {query !== "" && <Text>{`Search: ${query}`}</Text>}
      {error !== undefined && <Text color="red">{error}</Text>}
      {options.length === 0 ? (
        <Text dimColor>No matching languages</Text>
      ) : (
        <MultiSelect
          options={options}
          defaultValue={selected}
          // Settings title, help (up to three lines when wrapped), search, error, and footer.
          visibleOptionCount={listHeight({ rows, reserved: 8, max: 12 })}
          onChange={setSelected}
          onSubmit={(values) => {
            if (values.length === 0 && props.allowEmpty !== true) {
              setError("Select at least one language");
              return;
            }
            if (props.max !== undefined && values.length > props.max) {
              setError(`Select at most ${props.max} languages`);
              return;
            }
            props.onPick(values.length === 0 ? [] : normalizeLanguageHints(values));
          }}
        />
      )}
      <Text dimColor>{query !== "" ? "ESC clear search" : "ESC cancel"}</Text>
    </Box>
  );
}
