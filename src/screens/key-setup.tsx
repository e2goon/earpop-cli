import { PasswordInput, Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";

import { useEscape } from "#/hooks/use-escape.js";

interface KeySetupProps {
  error?: string;
  verifying: boolean;
  regionLabel: string;
  onBack: () => void;
  onSubmit: (key: string) => void;
}

export function KeySetup(props: KeySetupProps) {
  useEscape({ handler: props.onBack, active: !props.verifying });

  return (
    <Box flexDirection="column" gap={1}>
      <Text>{`Enter your Soniox API key for ${props.regionLabel}`}</Text>
      <Text dimColor>No key yet? Get a free one at https://console.soniox.com</Text>

      {props.verifying ? (
        <Spinner label="Verifying key" />
      ) : (
        <>
          {props.error !== undefined && <Text color="red">{props.error}</Text>}
          <PasswordInput placeholder="API key" onSubmit={props.onSubmit} />
          <Text dimColor>ESC choose another region</Text>
        </>
      )}
    </Box>
  );
}
