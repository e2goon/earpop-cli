import { Select, Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useMemo, useRef } from "react";

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
  const pickedRef = useRef<string | null>(null);
  const options = useMemo(
    () =>
      props.microphones.map((microphone) => ({
        label: microphone.name + (microphone.isDefault ? " (default)" : ""),
        value: microphone.name,
      })),
    [props.microphones],
  );

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
        options={options}
        defaultValue={props.current}
        onChange={(name) => {
          // @inkjs/ui Select re-sends the last choice on every re-render; report each pick once.
          if (pickedRef.current === name) return;
          pickedRef.current = name;
          props.onPick(name);
        }}
      />
      {props.onCancel && <Text dimColor>ESC cancel</Text>}
    </Box>
  );
}
