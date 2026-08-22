import { loadSettings } from "#/lib/settings.js";
import type { SttRegion } from "#/lib/types.js";

export const DEFAULT_REGION: SttRegion = "us";

function isRegion(value: string | undefined): value is SttRegion {
  return value === "us" || value === "eu" || value === "jp";
}

export async function resolveRegion() {
  const raw = process.env.SONIOX_REGION ?? (await loadSettings()).region;
  return isRegion(raw) ? raw : DEFAULT_REGION;
}
