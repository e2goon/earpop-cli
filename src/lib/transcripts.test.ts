import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { transcriptsDir } from "#/lib/journal.js";
import { listTranscripts, resolveTranscriptId } from "#/lib/transcripts.js";
import { useTempHome } from "#/test-utils/temp-home.js";

describe("listTranscripts", () => {
  useTempHome();

  before(() => {
    mkdirSync(transcriptsDir(), { recursive: true });
    const meeting = (startedAt: string) =>
      JSON.stringify({ kind: "meeting", started_at: startedAt, model: "stt-rt-v6" });
    const tokens = Array.from({ length: 2_000 }, (_, index) =>
      JSON.stringify({
        kind: "token",
        at_ms: index * 100,
        end_ms: index * 100 + 80,
        text: " word",
      }),
    );
    writeFileSync(
      join(transcriptsDir(), "2026-11-14_10-00-00.jsonl"),
      [meeting("2026-11-14T10:00:00+09:00"), ...tokens, '{"kind":"ended","at_ms":200500}', ""].join(
        "\n",
      ),
    );
    // A crashed session has no ended line; the last token still gives the length.
    writeFileSync(
      join(transcriptsDir(), "2026-11-15_09-00-00.jsonl"),
      [meeting("2026-11-15T09:00:00+09:00"), ...tokens.slice(0, 650), ""].join("\n"),
    );
    writeFileSync(join(transcriptsDir(), "notes.txt"), "ignored");
  });

  it("lists newest first with the recorded length", async () => {
    assert.deepEqual(await listTranscripts(), [
      { id: "2026-11-15_09-00-00", startedAt: "2026-11-15T09:00:00+09:00", duration: "01:04" },
      { id: "2026-11-14_10-00-00", startedAt: "2026-11-14T10:00:00+09:00", duration: "03:20" },
    ]);
  });

  it("resolves latest to the newest transcript", async () => {
    assert.equal(await resolveTranscriptId("latest"), "2026-11-15_09-00-00");
    assert.equal(await resolveTranscriptId("other"), "other");
  });
});
