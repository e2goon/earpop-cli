import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { openJournal } from "#/lib/journal.js";
import { readTranscript } from "#/lib/transcripts.js";
import { useTempHome } from "#/test-utils/temp-home.js";

describe("journal", () => {
  useTempHome();

  it("files translations at the end of the speech they follow", async () => {
    const journal = openJournal("stt-rt-v6");
    journal.tokens({
      offsetMs: 10_000,
      tokens: [
        { text: "Hi", isFinal: true, speaker: "1", language: "en", startMs: 100, endMs: 400 },
        {
          text: "Hola",
          isFinal: true,
          speaker: "1",
          language: "es",
          translation: true,
          sourceLanguage: "en",
        },
      ],
    });
    journal.close();

    const lines = readFileSync(journal.path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(lines[2], {
      kind: "token",
      at_ms: 10_400,
      end_ms: 10_400,
      text: "Hola",
      speaker: "1",
      language: "es",
      translation: true,
      source_language: "en",
    });

    const transcript = await readTranscript(journal.id);
    assert.deepEqual(
      transcript.tokens.map((token) => [token.text, token.atMs, token.translation === true]),
      [
        ["Hi", 10_100, false],
        ["Hola", 10_400, true],
      ],
    );
    assert.equal(transcript.tokens[1]!.sourceLanguage, "en");
  });
});
