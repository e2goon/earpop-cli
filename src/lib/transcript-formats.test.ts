import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderTranscript, toCues, toParagraphs } from "#/lib/transcript-formats.js";
import type { TranscriptToken } from "#/lib/transcripts.js";

function token(atMs: number, text: string, extra: Partial<TranscriptToken> = {}): TranscriptToken {
  return { text, isFinal: true, atMs, endMs: atMs + 100, speaker: "1", ...extra };
}

const transcript = (tokens: TranscriptToken[]) => ({
  startedAt: "2026-11-14T10:00:00+09:00",
  model: "stt-rt-v6",
  tokens,
});

describe("toParagraphs", () => {
  it("splits on speaker change and long pauses", () => {
    const paragraphs = toParagraphs([
      token(0, "Hi"),
      token(200, " there"),
      token(400, "Yo", { speaker: "2" }),
      token(3_000, " again", { speaker: "2" }),
    ]);
    assert.deepEqual(
      paragraphs.map((paragraph) => [paragraph.speaker, paragraph.text, paragraph.startMs]),
      [
        ["1", "Hi there", 0],
        ["2", "Yo", 400],
        ["2", "again", 3_000],
      ],
    );
    assert.equal(paragraphs[0]!.endMs, 300);
  });

  it("splits when the language changes", () => {
    const paragraphs = toParagraphs([
      token(0, "Hello", { language: "en" }),
      token(100, ".", { language: "en" }),
      token(200, " ", { language: "ko" }),
      token(300, "안녕하세요", { language: "ko" }),
    ]);
    assert.deepEqual(
      paragraphs.map((paragraph) => [paragraph.language, paragraph.text]),
      [
        ["en", "Hello."],
        ["ko", "안녕하세요"],
      ],
    );
  });
});

describe("txt", () => {
  it("omits language labels for a single-language transcript", () => {
    const text = renderTranscript({
      id: "a",
      transcript: transcript([token(0, "Hi", { language: "en" })]),
      format: "txt",
    });
    assert.equal(
      text,
      [
        "earpop transcript v1",
        "id: a",
        "started: 2026-11-14T10:00:00+09:00",
        "model: stt-rt-v6",
        "",
        "[00:00] S1: Hi",
        "",
      ].join("\n"),
    );
  });

  it("labels languages when the transcript mixes them", () => {
    const text = renderTranscript({
      id: "b",
      transcript: transcript([
        token(0, "Hi", { language: "en" }),
        token(61_000, "はい", { language: "ja", speaker: "2" }),
      ]),
      format: "txt",
    });
    assert.match(text, /^languages: en, ja$/m);
    assert.match(text, /^\[00:00\] S1 \(en\): Hi$/m);
    assert.match(text, /^\[01:01\] S2 \(ja\): はい$/m);
  });
});

const conversation = transcript([
  token(0, "Hey", { language: "en" }),
  token(200, ",", { language: "en" }),
  token(300, " how", { language: "en" }),
  token(500, " are", { language: "en" }),
  token(700, " you", { language: "en" }),
  token(800, "?", { language: "en", endMs: 900 }),
  token(1_500, " Hola", { language: "es", speaker: "2" }),
  token(1_700, ".", { language: "es", speaker: "2" }),
  token(1_900, " Bien", { language: "es", speaker: "2" }),
  token(2_100, " <3", { language: "es", speaker: "2", endMs: 2_400 }),
]);

describe("toCues", () => {
  it("splits subtitle cues at sentence ends and keeps short cues readable", () => {
    assert.deepEqual(
      toCues(conversation.tokens).map((cue) => [cue.speaker, cue.text, cue.startMs, cue.endMs]),
      [
        ["1", "Hey, how are you?", 0, 900],
        ["2", "Hola.", 1_500, 1_900],
        ["2", "Bien <3", 1_900, 2_600],
      ],
    );
  });

  it("caps cue length", () => {
    const words = Array.from({ length: 40 }, (_, index) =>
      token(index * 100, index === 0 ? "word" : " word"),
    );
    const cues = toCues(words);
    assert.ok(cues.length > 1);
    assert.ok(cues.every((cue) => cue.text.length <= 84));
  });

  it("stretches cues that lack end times without overlapping the next cue", () => {
    const cues = toCues([
      { text: "One", isFinal: true, atMs: 0, speaker: "1" },
      { text: ".", isFinal: true, atMs: 10, speaker: "1" },
      { text: " Two", isFinal: true, atMs: 400, speaker: "1" },
    ]);
    assert.deepEqual(
      cues.map((cue) => [cue.startMs, cue.endMs]),
      [
        [0, 400],
        [400, 1_100],
      ],
    );
  });
});

describe("subtitle formats", () => {
  it("renders SRT", () => {
    const srt = renderTranscript({ id: "c", transcript: conversation, format: "srt" });
    assert.equal(
      srt.split("\n").slice(0, 8).join("\n"),
      [
        "1",
        "00:00:00,000 --> 00:00:00,900",
        "S1 (en): Hey, how are you?",
        "",
        "2",
        "00:00:01,500 --> 00:00:01,900",
        "S2 (es): Hola.",
        "",
      ].join("\n"),
    );
  });

  it("renders WebVTT with voice and language spans, escaping markup", () => {
    const vtt = renderTranscript({ id: "c", transcript: conversation, format: "vtt" });
    assert.ok(vtt.startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:00.900\n"));
    assert.match(vtt, /^<v S1 \(en\)><lang en>Hey, how are you\?<\/lang>$/m);
    assert.match(vtt, /^<v S2 \(es\)><lang es>Bien &lt;3<\/lang>$/m);
  });

  it("renders Markdown", () => {
    const md = renderTranscript({ id: "c", transcript: conversation, format: "md" });
    assert.equal(
      md,
      [
        "# Transcript c",
        "",
        "- Started: 2026-11-14T10:00:00+09:00",
        "- Model: stt-rt-v6",
        "- Languages: en, es",
        "",
        "**[00:00] S1 (en):** Hey, how are you?",
        "",
        "**[00:01] S2 (es):** Hola. Bien <3",
        "",
      ].join("\n"),
    );
  });
});

describe("translations", () => {
  const translated = (atMs: number, text: string, extra: Partial<TranscriptToken> = {}) =>
    token(atMs, text, { translation: true, language: "es", sourceLanguage: "en", ...extra });
  const bilingual = transcript([
    token(1_000, "Hey", { language: "en" }),
    token(1_200, "?", { language: "en", endMs: 1_500 }),
    translated(1_500, "Oye"),
    translated(1_500, "?"),
    token(4_000, " Bye", { language: "en", endMs: 4_600 }),
    translated(4_600, " Adiós"),
  ]);

  it("labels translated paragraphs and keeps the speech time", () => {
    const text = renderTranscript({ id: "t", transcript: bilingual, format: "txt" });
    assert.deepEqual(text.trimEnd().split("\n").slice(-4), [
      "[00:01] S1 (en): Hey?",
      "[00:01] S1 (es translation): Oye?",
      "[00:04] S1 (en): Bye",
      "[00:04] S1 (es translation): Adiós",
    ]);
  });

  it("stacks translation cues on the speech cue in SRT", () => {
    const srt = renderTranscript({ id: "t", transcript: bilingual, format: "srt" });
    const blocks = srt.trim().split("\n\n");
    assert.deepEqual(blocks.slice(0, 2), [
      "1\n00:00:01,000 --> 00:00:01,700\nS1 (en): Hey?",
      "2\n00:00:01,000 --> 00:00:01,700\nS1 (es translation): Oye?",
    ]);
  });

  it("spans a translation over every cue of a long sentence", () => {
    const words = Array.from({ length: 30 }, (_, index) =>
      token(index * 300, index === 0 ? "word" : " word", { language: "en" }),
    );
    const cues = toCues([...words, translated(9_000, "palabras")]);
    const spoken = cues.filter((cue) => cue.translation !== true);
    const translation = cues.find((cue) => cue.translation === true)!;
    assert.ok(spoken.length > 1);
    assert.equal(translation.startMs, spoken[0]!.startMs);
    assert.equal(translation.endMs, spoken.at(-1)!.endMs);
  });
});
