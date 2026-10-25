import { Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";

import { Select } from "#/components/select.js";
import type { Microphone } from "#/lib/types.js";

interface MicrophoneSelectProps {
  microphones: Microphone[];
  current?: string;
  loading: boolean;
  error?: string;
  onPick: (name: string) => void;
  onCancel?: () => void;
}

export function MicrophoneSelect(props: MicrophoneSelectProps) {
  useInput((_input, key) => {
    if (key.escape && props.onCancel) props.onCancel();
  });

  if (props.loading) {
    return <Spinner label="Finding microphones" />;
  }

  if (props.error !== undefined) {
    return (
      <Box flexDirection="column">
        <Text color="red">{props.error}</Text>
        {props.onCancel && <Text dimColor>ESC to go back</Text>}
      </Box>
    );
  }

  if (props.microphones.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">No microphones available.</Text>
        <Text dimColor>Connect a microphone and allow access in System Settings.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Select
        options={props.microphones.map((microphone) => ({
          label: microphone.name + (microphone.isDefault ? " (default)" : ""),
          value: microphone.name,
        }))}
        defaultValue={props.current}
        onChange={props.onPick}
      />
      {props.onCancel && <Text dimColor>ESC cancel</Text>}
    </Box>
  );
}
