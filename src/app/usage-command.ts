import { parseArgs } from "node:util";

import { loadApiKey } from "#/lib/api-key.js";
import { errorMessage } from "#/lib/errors.js";
import { regionLabel, resolveRegion } from "#/lib/region.js";
import { loadSettings } from "#/lib/settings.js";
import { DEFAULT_USAGE_DAYS, fetchUsage, formatUsageReport, USAGE_MAX_DAYS } from "#/lib/usage.js";

const USAGE = `Usage: earpop usage [--days <1-${USAGE_MAX_DAYS}>] [--json]`;

export async function runUsageCommand(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        days: { type: "string", short: "d" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new Error(`${errorMessage(error)}\n${USAGE}`);
  }

  if (parsed.values.help === true) {
    console.log(USAGE);
    return;
  }

  if (parsed.positionals.length > 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  let days = DEFAULT_USAGE_DAYS;
  if (parsed.values.days !== undefined) {
    const value = Number(parsed.values.days);
    if (!Number.isInteger(value) || value < 1 || value > USAGE_MAX_DAYS) {
      throw new Error(`Invalid --days value: ${parsed.values.days}. Use 1 to ${USAGE_MAX_DAYS}.`);
    }
    days = value;
  }

  const settings = await loadSettings();
  const region = resolveRegion(settings);
  const apiKey = await loadApiKey(region);
  if (apiKey === null) {
    throw new Error(
      `No API key saved for ${regionLabel(region)}. Run \`earpop\` or \`earpop settings\` to save one, or set SONIOX_API_KEY.`,
    );
  }

  const summary = await fetchUsage({ apiKey, region, days });
  if (parsed.values.json === true) {
    console.log(JSON.stringify({ region, ...summary }, null, 2));
    return;
  }

  console.log(formatUsageReport({ summary, region }));
}
