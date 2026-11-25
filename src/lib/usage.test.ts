import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchUsage, formatUsageReport, summarizeUsage, usageWindow } from "#/lib/usage.js";

describe("usageWindow", () => {
  it("builds inclusive UTC start and exclusive tomorrow UTC end", () => {
    const now = new Date("2026-11-25T15:30:00+09:00");
    assert.deepEqual(usageWindow({ days: 7, now }), {
      days: 7,
      startTime: "2026-11-19T00:00:00.000Z",
      endTime: "2026-11-26T00:00:00.000Z",
    });
  });

  it("rejects out-of-range days", () => {
    assert.throws(() => usageWindow({ days: 0 }), /between 1 and 366/);
    assert.throws(() => usageWindow({ days: 367 }), /between 1 and 366/);
  });
});

describe("summarizeUsage", () => {
  const sample = {
    total: {
      model: null,
      days: ["2026-10-31", "2026-11-01", "2026-11-25"],
      total_cost_usd: "1.2500",
      total_api_cost_usd: "1.2000",
      total_playground_cost_usd: "0.0500",
      cost_usd: ["0.5000", "0.2500", "0.5000"],
      total_num_requests: 30,
      num_requests: [10, 5, 15],
      total_input_audio_duration_ms: 90_000,
      input_audio_duration_ms: [30_000, 15_000, 45_000],
      total_duration_ms: 0,
      duration_ms: [0, 0, 0],
    },
    models: [
      {
        model: "stt-rt-v5",
        total_cost_usd: "0.2500",
        total_num_requests: 5,
        total_input_audio_duration_ms: 15_000,
        total_duration_ms: 0,
      },
      {
        model: "stt-rt-v6\x1b[31m",
        total_cost_usd: "1.0000",
        total_num_requests: 25,
        total_input_audio_duration_ms: 75_000,
        total_duration_ms: 0,
      },
    ],
  };

  it("aggregates today, this month, period, and sorted sanitized models", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const summary = summarizeUsage({
      raw: sample,
      days: 30,
      startTime: "2026-10-27T00:00:00.000Z",
      endTime: "2026-11-26T00:00:00.000Z",
      now,
    });
    assert.deepEqual(summary.today, { costUsd: 0.5, requests: 15, audioMs: 45_000 });
    assert.deepEqual(summary.thisMonth, { costUsd: 0.75, requests: 20, audioMs: 60_000 });
    assert.equal(summary.period.costUsd, 1.25);
    assert.equal(summary.period.playgroundCostUsd, 0.05);
    assert.equal(summary.models[0]!.model, "stt-rt-v6");
    assert.equal(summary.models[1]!.model, "stt-rt-v5");
  });

  it("formats a readable report", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const summary = summarizeUsage({
      raw: sample,
      days: 30,
      startTime: "2026-10-27T00:00:00.000Z",
      endTime: "2026-11-26T00:00:00.000Z",
      now,
    });
    const text = formatUsageReport({ summary, region: "jp" });
    assert.match(text, /Japan \(Tokyo\), jp/);
    assert.match(text, /Today \(UTC\).*\$0\.5000.*45s.*15 requests/);
    assert.match(text, /This month \(UTC\).*\$0\.7500/);
    assert.match(text, /stt-rt-v6.*\$1\.0000/);

    const partial = summarizeUsage({
      raw: sample,
      days: 7,
      startTime: "2026-11-19T00:00:00.000Z",
      endTime: "2026-11-26T00:00:00.000Z",
      now,
    });
    assert.equal(partial.thisMonth, null);
    assert.doesNotMatch(
      formatUsageReport({ summary: partial, region: "jp" }),
      /This month \(UTC\)/,
    );
  });
});

describe("fetchUsage", () => {
  it("queries the regional endpoint with bearer auth and handles 401 cleanly", async () => {
    let calledUrl = "";
    let authHeader = "";
    const okFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(input);
      authHeader = (init?.headers as Record<string, string>)?.Authorization ?? "";
      return new Response(
        JSON.stringify({
          total: {
            days: ["2026-11-25"],
            total_cost_usd: "0.1000",
            total_api_cost_usd: "0.1000",
            total_playground_cost_usd: "0.0000",
            cost_usd: ["0.1000"],
            total_num_requests: 2,
            num_requests: [2],
            total_input_audio_duration_ms: 5_000,
            input_audio_duration_ms: [5_000],
            total_duration_ms: 0,
            duration_ms: [0],
          },
          models: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await fetchUsage({
      apiKey: "snx_test_key",
      region: "eu",
      days: 30,
      now: new Date("2026-11-25T12:00:00Z"),
      fetchImpl: okFetch,
    });
    assert.match(calledUrl, /^https:\/\/api\.eu\.soniox\.com\/v1\/usage\/summary\?/);
    assert.equal(authHeader, "Bearer snx_test_key");
    assert.equal(result.period.requests, 2);

    const errFetch = (async () =>
      new Response(JSON.stringify({ error_message: "Invalid key\x1b[31m" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await assert.rejects(
      () => fetchUsage({ apiKey: "bad", region: "us", fetchImpl: errFetch }),
      /Soniox rejected the API key for United States \(Invalid key\)/,
    );
  });
});
