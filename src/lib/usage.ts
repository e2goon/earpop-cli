import { REGION_API_URLS, regionLabel } from "#/lib/region.js";
import { stripTerminalEscapes } from "#/lib/sanitize.js";
import type { SttRegion } from "#/lib/types.js";

export const USAGE_MAX_DAYS = 366;
export const DEFAULT_USAGE_DAYS = 365;
const USAGE_TIMEOUT_MS = 15_000;

interface UsageBucketRaw {
  model?: unknown;
  days?: unknown;
  total_cost_usd?: unknown;
  total_api_cost_usd?: unknown;
  total_playground_cost_usd?: unknown;
  cost_usd?: unknown;
  total_num_requests?: unknown;
  num_requests?: unknown;
  total_input_audio_duration_ms?: unknown;
  input_audio_duration_ms?: unknown;
  total_duration_ms?: unknown;
  duration_ms?: unknown;
}

export interface UsageSummaryResponse {
  total?: UsageBucketRaw;
  models?: UsageBucketRaw[];
}

interface UsageTotals {
  costUsd: number;
  requests: number;
  audioMs: number;
}

interface UsageModelTotals extends UsageTotals {
  model: string;
}

export interface UsageSummary {
  days: number;
  startTime: string;
  endTime: string;
  today: UsageTotals;
  thisMonth: UsageTotals | null;
  period: UsageTotals & { apiCostUsd: number; playgroundCostUsd: number };
  models: UsageModelTotals[];
}

function utcDayStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function usageWindow({ days = DEFAULT_USAGE_DAYS, now = new Date() } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > USAGE_MAX_DAYS) {
    throw new Error(`--days must be an integer between 1 and ${USAGE_MAX_DAYS}`);
  }
  const today = utcDayStart(now);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    days,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function asNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function atIndex({ list, index }: { list: unknown; index: number }) {
  return Array.isArray(list) ? asNumber(list[index]) : 0;
}

function audioDurationMs({
  inputAudioMs,
  durationMs,
}: {
  inputAudioMs: unknown;
  durationMs: unknown;
}) {
  return asNumber(inputAudioMs) + asNumber(durationMs);
}

export function summarizeUsage({
  raw,
  days,
  startTime,
  endTime,
  now = new Date(),
}: {
  raw: UsageSummaryResponse;
  days: number;
  startTime: string;
  endTime: string;
  now?: Date;
}) {
  const total = raw.total ?? {};
  const utcDate = utcDayStart(now).toISOString().slice(0, 10);
  const utcMonth = utcDate.slice(0, 7);
  const coversMonth = startTime <= `${utcMonth}-01T00:00:00.000Z`;

  const today: UsageTotals = { costUsd: 0, requests: 0, audioMs: 0 };
  const monthTotals: UsageTotals = { costUsd: 0, requests: 0, audioMs: 0 };

  const dayList = Array.isArray(total.days) ? total.days : [];
  for (let i = 0; i < dayList.length; i += 1) {
    const day = dayList[i];
    if (typeof day !== "string") continue;
    const cost = atIndex({ list: total.cost_usd, index: i });
    const requests = atIndex({ list: total.num_requests, index: i });
    const audioMs = audioDurationMs({
      inputAudioMs: atIndex({ list: total.input_audio_duration_ms, index: i }),
      durationMs: atIndex({ list: total.duration_ms, index: i }),
    });
    if (day === utcDate) {
      today.costUsd += cost;
      today.requests += requests;
      today.audioMs += audioMs;
    }
    if (coversMonth && day.startsWith(utcMonth)) {
      monthTotals.costUsd += cost;
      monthTotals.requests += requests;
      monthTotals.audioMs += audioMs;
    }
  }

  const period = {
    costUsd: asNumber(total.total_cost_usd),
    apiCostUsd: asNumber(total.total_api_cost_usd),
    playgroundCostUsd: asNumber(total.total_playground_cost_usd),
    requests: asNumber(total.total_num_requests),
    audioMs: audioDurationMs({
      inputAudioMs: total.total_input_audio_duration_ms,
      durationMs: total.total_duration_ms,
    }),
  };

  const models: UsageModelTotals[] = [];
  for (const item of raw.models ?? []) {
    const model =
      typeof item.model === "string" && item.model.trim() !== ""
        ? stripTerminalEscapes(item.model)
        : "(unknown)";
    models.push({
      model,
      costUsd: asNumber(item.total_cost_usd),
      requests: asNumber(item.total_num_requests),
      audioMs: audioDurationMs({
        inputAudioMs: item.total_input_audio_duration_ms,
        durationMs: item.total_duration_ms,
      }),
    });
  }
  models.sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);

  return {
    days,
    startTime,
    endTime,
    today,
    thisMonth: coversMonth ? monthTotals : null,
    period,
    models,
  } satisfies UsageSummary;
}

function formatUsd(amount: number) {
  return `$${amount.toFixed(4)}`;
}

function formatAudioDuration(ms: number) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatUsageReport({
  summary,
  region,
}: {
  summary: UsageSummary;
  region: SttRegion;
}) {
  const lines = [
    `Soniox project usage (${regionLabel(region)}, ${region})`,
    "",
    `Today (UTC)          ${formatUsd(summary.today.costUsd).padEnd(10)} ${formatAudioDuration(summary.today.audioMs).padEnd(12)} ${summary.today.requests} requests`,
    ...(summary.thisMonth !== null
      ? [
          `This month (UTC)     ${formatUsd(summary.thisMonth.costUsd).padEnd(10)} ${formatAudioDuration(summary.thisMonth.audioMs).padEnd(12)} ${summary.thisMonth.requests} requests`,
        ]
      : []),
    `Last ${String(summary.days).padEnd(3)} days (UTC)  ${formatUsd(summary.period.costUsd).padEnd(10)} ${formatAudioDuration(summary.period.audioMs).padEnd(12)} ${summary.period.requests} requests`,
  ];

  if (summary.period.playgroundCostUsd > 0) {
    lines.push(
      `  Breakdown: API ${formatUsd(summary.period.apiCostUsd)}, Playground ${formatUsd(summary.period.playgroundCostUsd)}`,
    );
  }

  if (summary.models.length > 0) {
    lines.push("", "By model:");
    const nameWidth = Math.max(12, ...summary.models.map((item) => item.model.length + 2));
    for (const item of summary.models) {
      lines.push(
        `  ${item.model.padEnd(nameWidth)} ${formatUsd(item.costUsd).padEnd(10)} ${formatAudioDuration(item.audioMs).padEnd(12)} ${item.requests} requests`,
      );
    }
  } else {
    lines.push("", "No model usage recorded in this window.");
  }

  lines.push(
    "",
    "Note: Remaining prepaid balance requires an Organization API key in https://console.soniox.com.",
  );
  return lines.join("\n");
}

export async function fetchUsage({
  apiKey,
  region,
  days = DEFAULT_USAGE_DAYS,
  now = new Date(),
  fetchImpl = fetch,
}: {
  apiKey: string;
  region: SttRegion;
  days?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}) {
  const window = usageWindow({ days, now });
  const url = new URL("/v1/usage/summary", REGION_API_URLS[region]);
  url.searchParams.set("start_time", window.startTime);
  url.searchParams.set("end_time", window.endTime);

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status} ${response.statusText}`.trim();
    try {
      const body = (await response.json()) as { error_message?: unknown; message?: unknown };
      const message =
        typeof body.error_message === "string"
          ? body.error_message
          : typeof body.message === "string"
            ? body.message
            : undefined;
      if (message !== undefined && message.trim() !== "") {
        detail = stripTerminalEscapes(message.trim());
      }
    } catch {
      // Non-JSON error response; fall back to HTTP status.
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Soniox rejected the API key for ${regionLabel(region)} (${detail}). Check your key or region with \`earpop settings\`.`,
      );
    }
    throw new Error(`Failed to fetch usage: ${detail}`);
  }

  const raw = (await response.json()) as UsageSummaryResponse;
  return summarizeUsage({ raw, ...window, now });
}
