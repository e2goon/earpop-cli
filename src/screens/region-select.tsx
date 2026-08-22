import { Select } from "@inkjs/ui";
import { Box, Text } from "ink";

import type { SttRegion } from "#/lib/types.js";

export interface RegionSelectProps {
  onPick: (region: SttRegion) => void;
}

export function RegionSelect(props: RegionSelectProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Which Soniox region will you use?</Text>
      <Text dimColor>
        API keys are issued per project region. Pick the region that has your key.
      </Text>
      <Select
        options={[
          { label: "United States (us) — default", value: "us" },
          { label: "Europe (eu)", value: "eu" },
          { label: "Japan / Tokyo (jp)", value: "jp" },
        ]}
        onChange={(value) => props.onPick(value as SttRegion)}
      />
    </Box>
  );
}
