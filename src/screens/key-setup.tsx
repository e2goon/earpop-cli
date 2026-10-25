import { PasswordInput, Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";

interface KeySetupProps {
  error?: string;
  verifying: boolean;
  regionLabel: string;
  onSubmit: (key: string) => void;
}

export function KeySetup(props: KeySetupProps) {
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
        </>
      )}
    </Box>
  );
}
