import type { CliSettings } from "#/lib/types.js";

export const REGIONS = [
  { code: "us", label: "United States", option: "United States (us)" },
  { code: "eu", label: "Europe", option: "Europe (eu)" },
  { code: "jp", label: "Japan (Tokyo)", option: "Japan / Tokyo (jp)" },
] as const;

export type SttRegion = (typeof REGIONS)[number]["code"];

export const DEFAULT_REGION: SttRegion = "us";

export function isRegion(value: unknown): value is SttRegion {
  return REGIONS.some((region) => region.code === value);
}

export function regionLabel(value: SttRegion) {
  return REGIONS.find((region) => region.code === value)!.label;
}

export function resolveRegion(settings: CliSettings) {
  const raw = process.env.SONIOX_REGION ?? settings.region;
  return isRegion(raw) ? raw : DEFAULT_REGION;
}
