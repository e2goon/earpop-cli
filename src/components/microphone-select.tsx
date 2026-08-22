import { Select, Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";

import type { Microphone } from "#/lib/types.js";

export interface MicrophoneSelectProps {
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
        <Text dimColor>Make sure ffmpeg is installed and a microphone is connected.</Text>
      </Box>
    );
  }

  const options = props.microphones.map((microphone) => ({
    label: microphone.name + (microphone.isDefault ? " (default)" : ""),
    value: microphone.name,
  }));

  return (
    <Box flexDirection="column" gap={1}>
      <Select
        options={options}
        defaultValue={props.current}
        onChange={(name) => props.onPick(name)}
      />
      {props.onCancel && <Text dimColor>ESC cancel</Text>}
    </Box>
  );
}
