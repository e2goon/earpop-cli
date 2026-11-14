import { Box, Text } from "ink";

import { Select } from "#/components/select.js";
import { useEscape } from "#/hooks/use-escape.js";
import { DEFAULT_REGION, REGIONS } from "#/lib/region.js";
import type { SttRegion } from "#/lib/types.js";

export function RegionSelect(props: { onPick: (region: SttRegion) => void; onCancel: () => void }) {
  useEscape({ handler: props.onCancel });

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
      <Text dimColor>ESC quit</Text>
    </Box>
  );
}
