import { Box, Text } from "ink";

import { Select } from "#/components/select.js";
import { DEFAULT_REGION, REGIONS } from "#/lib/region.js";
import type { SttRegion } from "#/lib/types.js";

export function RegionSelect(props: { onPick: (region: SttRegion) => void }) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Which Soniox region will you use?</Text>
      <Text dimColor>
        API keys are issued per project region. Pick the region that has your key.
      </Text>
      <Select
        options={REGIONS.map((region) => ({
          label: `${region.option}${region.code === DEFAULT_REGION ? " (default)" : ""}`,
          value: region.code,
        }))}
        onChange={(value) => props.onPick(value as SttRegion)}
      />
    </Box>
  );
}
