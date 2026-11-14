import { Spinner } from "@inkjs/ui";
import { Box, Text, useWindowSize } from "ink";

import { listHeight } from "#/components/list-height.js";
import { Select } from "#/components/select.js";
import { useEscape } from "#/hooks/use-escape.js";
import { micPermissionHint } from "#/lib/audio.js";
import type { Microphone } from "#/lib/types.js";

interface MicrophoneSelectProps {
  microphones: Microphone[];
  current?: string;
  loading: boolean;
  error?: string;
  onPick: (name: string) => void;
  onCancel?: () => void;
  /** Footer for ESC; defaults to "ESC cancel". */
  cancelLabel?: string;
  /** Rows this list may use; defaults to the terminal height. */
  rows?: number;
}

export function MicrophoneSelect(props: MicrophoneSelectProps) {
  const windowRows = useWindowSize().rows;
  useEscape({ handler: () => props.onCancel?.(), active: props.onCancel !== undefined });
  const footer = props.onCancel && <Text dimColor>{props.cancelLabel ?? "ESC cancel"}</Text>;

  if (props.loading) {
    return <Spinner label="Finding microphones" />;
  }

  if (props.error !== undefined) {
    return (
      <Box flexDirection="column">
        <Text color="red">{props.error}</Text>
        {footer}
      </Box>
    );
  }

  if (props.microphones.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">No microphones available.</Text>
        <Text dimColor>{`Connect a microphone. ${micPermissionHint()}.`}</Text>
        {footer}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Select
        // Keep the list inside short terminals; the rest scrolls.
        visibleOptionCount={listHeight({ rows: props.rows ?? windowRows, reserved: 4, max: 10 })}
        // The system default first: it is the right pick for most people.
        options={[...props.microphones]
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
          .map((microphone) => ({
            label:
              microphone.name +
              (microphone.isDefault ? " (default)" : "") +
              (microphone.name === props.current ? " (current)" : ""),
            value: microphone.name,
          }))}
        onChange={props.onPick}
      />
      {footer}
    </Box>
  );
}
