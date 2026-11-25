import assert from "node:assert/strict";
import { describe, it } from "node:test";

import stringWidth from "string-width";

import {
  createUtteranceStream,
  toLines,
  utteranceMatchesFilter,
  wrapUtterances,
} from "#/lib/caption-layout.js";
import type { Token } from "#/lib/types.js";

// Soniox sends spacing as a leading space on the next token ("How", " are", " you", "?").
function finals(speaker: string, ...texts: string[]) {
  return texts.map((text): Token => ({ text, isFinal: true, speaker }));
}

function lines(finalTokens: Token[], pendingTokens: Token[] = []) {
  return toLines({ finalTokens, pendingTokens, focusedSpeakers: new Set(), tailChars: Infinity });
}

function rowText(rows: ReturnType<typeof wrapUtterances>) {
  return rows.map((row) => row.map((piece) => piece.text).join(""));
}

function wrap(tokens: Token[], width: number) {
  return rowText(wrapUtterances({ utterances: lines(tokens), width, maxLines: Infinity }));
}

function stableTexts(tokens: Token[]) {
  return lines(tokens).map((line) => line.stable.trim());
}

describe("toLines", () => {
  it("splits on a period followed by a new token", () => {
    const result = lines(finals("1", "We", " ship", " Friday", ".", " Any", " questions", "?"));
    assert.deepEqual(
      result.map((line) => line.stable),
      ["We ship Friday.", " Any questions?"],
    );
  });

  it("keeps decimals and a trailing period on the same line", () => {
    assert.deepEqual(stableTexts(finals("1", "Version", " 1", ".", "5", " ships", ".")), [
      "Version 1.5 ships.",
    ]);
  });

  it("splits after a period followed by an unspaced script", () => {
    assert.deepEqual(stableTexts(finals("1", "OK", ".", "了解", "。")), ["OK.", "了解。"]);
  });

  it("splits on sentence marks of other scripts", () => {
    assert.deepEqual(stableTexts(finals("1", "नमस्ते", "।", " आप", " कैसे", " हैं", "?")), [
      "नमस्ते।",
      "आप कैसे हैं?",
    ]);
    assert.deepEqual(stableTexts(finals("1", "مرحبا", "؟", " نعم")), ["مرحبا؟", "نعم"]);
    assert.deepEqual(stableTexts(finals("1", "شکریہ", "۔", " جی")), ["شکریہ۔", "جی"]);
    assert.deepEqual(stableTexts(finals("1", "はい", "。", "そうです")), ["はい。", "そうです"]);
  });

  it("looks past closing quotes", () => {
    assert.deepEqual(stableTexts(finals("1", "He", " said", ' "why?"', " Then")), [
      'He said "why?"',
      "Then",
    ]);
    assert.deepEqual(stableTexts(finals("1", "「はい。」", "次")), ["「はい。」", "次"]);
  });

  it("starts a new line after a long pause, for scripts without sentence marks", () => {
    const tokens: Token[] = [
      { text: "สวัสดี", isFinal: true, speaker: "1", startMs: 0, endMs: 500 },
      { text: "ครับ", isFinal: true, speaker: "1", startMs: 600, endMs: 900 },
      { text: "ไป", isFinal: true, speaker: "1", startMs: 3_500, endMs: 3_800 },
    ];
    assert.deepEqual(stableTexts(tokens), ["สวัสดีครับ", "ไป"]);
  });

  it("continues a period line into pending tokens", () => {
    const result = lines(finals("1", "Done", "."), [
      { text: " Next", isFinal: false, speaker: "1" },
    ]);
    assert.deepEqual(
      result.map((line) => [line.stable.trim(), line.pending.trim()]),
      [
        ["Done.", ""],
        ["", "Next"],
      ],
    );
  });
});

describe("wrapUtterances", () => {
  it("keeps a long unspaced sentence on the speaker tag row", () => {
    const utterances = lines(finals("1", "今日は", "とても", "良い", "天気", "ですね"));
    const rows = rowText(wrapUtterances({ utterances, width: 12, maxLines: Infinity }));
    assert.match(rows[0]!, /^\[S1\] \S/);
  });

  it("breaks unspaced scripts between words, never past the width", () => {
    const text = "今日は良い天気ですね。明日も晴れるでしょう。";
    for (const width of [10, 14, 20]) {
      const rows = wrap(finals("1", text), width);
      assert.ok(
        rows.every((row) => stringWidth(row) <= width),
        rows.join("|"),
      );
      assert.equal(rows.join("").replace(/\[S1\]|\s/g, ""), text);
    }
    assert.ok(!wrap(finals("1", text), 14).some((row) => row.trimStart().startsWith("。")));
  });

  it("breaks Thai on word boundaries", () => {
    const rows = wrap(finals("1", "สวัสดีครับวันนี้อากาศดีมาก"), 16);
    assert.ok(rows.length > 1);
    assert.ok(
      rows.every((row) => stringWidth(row) <= 16),
      rows.join("|"),
    );
  });

  it("wraps spaced words onto indented rows", () => {
    assert.deepEqual(
      wrap(finals("2", "alpha", " beta", " gamma", " delta"), 16).map((row) => row.trimEnd()),
      ["[S2] alpha beta", "     gamma delta"],
    );
  });

  it("splits a word that cannot fit beside the tag instead of orphaning the tag", () => {
    const rows = wrap(finals("1", "internationalization"), 12);
    assert.equal(rows[0], "[S1] interna");
    assert.ok(rows.every((row) => stringWidth(row) <= 12));
  });
});

describe("createUtteranceStream", () => {
  it("commits on sentence ends and flushes the trailing utterance", () => {
    const stream = createUtteranceStream();
    assert.deepEqual(stream.push(finals("1", "We", " ship", ".")), []);
    assert.equal(stream.activeTokens().length, 3);

    assert.deepEqual(
      stream.push(finals("1", " Any", " questions", "?")).map((item) => [item.speaker, item.text]),
      [
        ["1", "We ship."],
        ["1", " Any questions?"],
      ],
    );
    assert.deepEqual(stream.activeTokens(), []);

    assert.deepEqual(stream.push(finals("2", "Pending", " line")), []);
    assert.deepEqual(
      stream.flush().map((item) => [item.speaker, item.text]),
      [["2", "Pending line"]],
    );
    assert.deepEqual(stream.flush(), []);
  });

  it("matches speaker and language filters", () => {
    assert.equal(
      utteranceMatchesFilter({
        utterance: { speaker: "1", language: "en" },
        focusedSpeakers: new Set(["1"]),
        focusedLanguage: "en",
      }),
      true,
    );
    assert.equal(
      utteranceMatchesFilter({
        utterance: { speaker: "2", language: "en" },
        focusedSpeakers: new Set(["1"]),
      }),
      false,
    );
  });
});

describe("languages", () => {
  const mixed: Token[] = [
    { text: "Hello", isFinal: true, speaker: "1", language: "en" },
    { text: " there", isFinal: true, speaker: "1", language: "en" },
    { text: " ", isFinal: true, speaker: "1", language: "ko" },
    { text: "안녕", isFinal: true, speaker: "1", language: "ko" },
    { text: "하세요", isFinal: true, speaker: "1", language: "ko" },
  ];

  it("starts a new line when the language changes", () => {
    assert.deepEqual(
      lines(mixed).map((line) => [line.language, line.stable.trim()]),
      [
        ["en", "Hello there"],
        ["ko", "안녕하세요"],
      ],
    );
  });

  it("filters by language", () => {
    const result = toLines({
      finalTokens: mixed,
      pendingTokens: [],
      focusedSpeakers: new Set(),
      focusedLanguage: "ko",
      tailChars: Infinity,
    });
    assert.deepEqual(
      result.map((line) => line.stable.trim()),
      ["안녕하세요"],
    );
  });

  it("shows the language in the tag only when asked", () => {
    const utterances = lines(mixed);
    const render = (showLanguage: boolean) =>
      rowText(wrapUtterances({ utterances, width: 40, maxLines: Infinity, showLanguage })).map(
        (row) => row.trimEnd(),
      );
    const plain = render(false);
    const tagged = render(true);
    assert.deepEqual(plain, ["[S1] Hello there", "[S1] 안녕하세요"]);
    assert.deepEqual(tagged, ["[S1 en] Hello there", "[S1 ko] 안녕하세요"]);
  });
});

describe("translations", () => {
  const spoken = (text: string, language: string): Token => ({
    text,
    isFinal: true,
    speaker: "1",
    language,
  });
  const translated = (text: string, language: string): Token => ({
    ...spoken(text, language),
    translation: true,
    sourceLanguage: "en",
  });

  it("puts a translation on its own line under the speech", () => {
    const tokens = [
      spoken("Hey", "en"),
      spoken("?", "en"),
      translated("Oye", "es"),
      translated("?", "es"),
      spoken(" Fine", "en"),
    ];
    assert.deepEqual(
      lines(tokens).map((line) => [line.translation === true, line.stable.trim()]),
      [
        [false, "Hey?"],
        [true, "Oye?"],
        [false, "Fine"],
      ],
    );
  });

  it("splits a one-way translation into the same language as the speech", () => {
    const tokens = [spoken("Hello", "en"), translated(" Hello", "en")];
    assert.equal(lines(tokens).length, 2);
  });

  it("renders translations in italics", () => {
    const rows = wrapUtterances({
      utterances: lines([spoken("Hey", "en"), translated("Oye", "es")]),
      width: 40,
      maxLines: Infinity,
      showLanguage: true,
    });
    assert.deepEqual(
      rows.map((row) => row.map((piece) => [piece.text, piece.italic === true])),
      [
        [
          ["[S1 en] ", false],
          ["Hey", false],
        ],
        [
          ["[S1 es] ", false],
          ["Oye", true],
        ],
      ],
    );
  });
});
