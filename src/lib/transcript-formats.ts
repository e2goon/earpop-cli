import stringWidth from "string-width";

import { PAUSE_BREAK_MS, sentenceMark, startsNewWord } from "#/lib/segments.js";
import type { Transcript, TranscriptToken } from "#/lib/transcripts.js";

export const TRANSCRIPT_FORMATS = ["txt", "srt", "vtt", "md"] as const;

export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export function isTranscriptFormat(value: string): value is TranscriptFormat {
  return (TRANSCRIPT_FORMATS as readonly string[]).includes(value);
}

// Subtitle cues: about two lines of 42 columns, readable within a few seconds.
const CUE_MAX_WIDTH = 84;
const CUE_MAX_MS = 7_000;
const CUE_MIN_MS = 700;

export function formatStamp(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const minutesTotal = Math.floor(totalSeconds / 60);
  if (minutesTotal >= 60) {
    const hh = Math.floor(minutesTotal / 60);
    return `${hh}:${String(minutesTotal % 60).padStart(2, "0")}:${ss}`;
  }
  return `${String(minutesTotal).padStart(2, "0")}:${ss}`;
}

function cueStamp({ ms, separator }: { ms: number; separator: "," | "." }) {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(ms % 1000, 3)}`;
}

interface Paragraph {
  startMs: number;
  endMs: number;
  speaker?: string;
  language?: string;
  translation?: boolean;
  text: string;
}

// Translations carry no timestamps: show each over all the speech since the previous
// translation, which may span several cues when a long sentence was split.
function alignTranslations(blocks: Paragraph[]) {
  let first: Paragraph | undefined;
  let last: Paragraph | undefined;
  let untranslated = true;
  for (const block of blocks) {
    if (block.translation !== true) {
      if (!untranslated) first = undefined;
      untranslated = true;
      first ??= block;
      last = block;
    } else if (first !== undefined && last !== undefined) {
      untranslated = false;
      block.startMs = first.startMs;
      block.endMs = last.endMs;
    }
  }
  return blocks;
}

/**
 * Groups tokens into blocks that share a speaker, language, and translation status, split at
 * long pauses. Cues are also split at sentence ends and subtitle length limits.
 */
function groupTokens({ tokens, cues }: { tokens: TranscriptToken[]; cues: boolean }) {
  const blocks: Paragraph[] = [];
  let lastAtMs = 0;
  let currentWidth = 0;
  for (const token of tokens) {
    const previous = blocks.at(-1);
    if (token.text.trim() === "") {
      if (previous !== undefined) {
        previous.text += token.text;
        if (cues) currentWidth += stringWidth(token.text);
      }
      continue;
    }
    const spoken = token.translation !== true;
    const tokenWidth = cues ? stringWidth(token.text) : 0;
    if (
      previous === undefined ||
      token.speaker !== previous.speaker ||
      spoken === (previous.translation === true) ||
      (spoken && token.atMs - lastAtMs > PAUSE_BREAK_MS) ||
      (token.language !== undefined &&
        previous.language !== undefined &&
        token.language !== previous.language) ||
      (cues &&
        startsNewWord(token.text) &&
        (sentenceMark(previous.text) !== null ||
          currentWidth + tokenWidth > CUE_MAX_WIDTH ||
          (spoken && token.atMs - previous.startMs > CUE_MAX_MS)))
    ) {
      blocks.push({
        startMs: token.atMs,
        endMs: token.endMs ?? token.atMs,
        speaker: token.speaker,
        language: token.language,
        ...(spoken ? {} : { translation: true }),
        text: token.text,
      });
      currentWidth = cues ? stringWidth(token.text.trimStart()) : 0;
    } else {
      previous.text += token.text;
      currentWidth += tokenWidth;
      previous.endMs = Math.max(previous.endMs, token.endMs ?? token.atMs);
    }
    if (spoken) lastAtMs = token.atMs;
  }
  for (const block of blocks) block.text = block.text.trim();
  return blocks;
}

/** Groups tokens by speaker, language, and pauses longer than two seconds. */
export function toParagraphs(tokens: TranscriptToken[]) {
  return alignTranslations(groupTokens({ tokens, cues: false }));
}

/** Subtitle-sized blocks: paragraphs further split at sentence ends and length limits. */
export function toCues(tokens: TranscriptToken[]) {
  const cues = groupTokens({ tokens, cues: true });
  // Tokens without end times would give zero-length cues; stretch them without overlapping.
  const spoken = cues.filter((cue) => cue.translation !== true);
  spoken.forEach((cue, index) => {
    const next = spoken[index + 1];
    const minimum = cue.startMs + CUE_MIN_MS;
    if (cue.endMs < minimum) {
      cue.endMs =
        next === undefined ? minimum : Math.max(cue.endMs, Math.min(minimum, next.startMs));
    }
  });
  return alignTranslations(cues);
}

// Language labels only add noise when the whole transcript is in one language.
function labelLanguages(blocks: Paragraph[]) {
  const languages = [
    ...new Set(blocks.flatMap((block) => (block.language !== undefined ? [block.language] : []))),
  ];
  const show = languages.length > 1 || blocks.some((block) => block.translation === true);
  return { languages, show };
}

function speakerLabel({ block, showLanguage }: { block: Paragraph; showLanguage: boolean }) {
  const speaker = block.speaker !== undefined ? `S${block.speaker}` : "S?";
  if (block.translation === true) return `${speaker} (${block.language ?? "?"} translation)`;
  return showLanguage && block.language !== undefined ? `${speaker} (${block.language})` : speaker;
}

function renderParagraphs({
  id,
  transcript,
  markdown,
}: {
  id: string;
  transcript: Transcript;
  markdown: boolean;
}) {
  const paragraphs = toParagraphs(transcript.tokens);
  const { languages, show } = labelLanguages(paragraphs);
  const facts: Array<[string, string]> = [];
  if (transcript.startedAt !== "") facts.push(["started", transcript.startedAt]);
  if (transcript.model !== "") facts.push(["model", transcript.model]);
  if (show) facts.push(["languages", languages.join(", ")]);

  const lines = paragraphs.map((paragraph) => {
    const label = `[${formatStamp(paragraph.startMs)}] ${speakerLabel({ block: paragraph, showLanguage: show })}:`;
    return markdown ? `**${label}** ${paragraph.text}` : `${label} ${paragraph.text}`;
  });

  if (!markdown) {
    const head = [
      "earpop transcript v1",
      `id: ${id}`,
      ...facts.map(([key, value]) => `${key}: ${value}`),
    ];
    return [...head, "", ...lines].join("\n") + "\n";
  }
  const head = [`# Transcript ${id}`, ""];
  if (facts.length > 0) {
    const title = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
    head.push(...facts.map(([key, value]) => `- ${title(key)}: ${value}`), "");
  }
  return [...head, lines.join("\n\n")].join("\n").trimEnd() + "\n";
}

function escapeVtt(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderCues({ transcript, vtt }: { transcript: Transcript; vtt: boolean }) {
  const cues = toCues(transcript.tokens);
  const { show } = labelLanguages(cues);
  const separator = vtt ? "." : ",";
  const blocks = cues.map((cue, index) => {
    const timing = `${cueStamp({ ms: cue.startMs, separator })} --> ${cueStamp({ ms: cue.endMs, separator })}`;
    const label = speakerLabel({ block: cue, showLanguage: show });
    if (!vtt) return [String(index + 1), timing, `${label}: ${cue.text}`, ""].join("\n");
    // `<v>` names the speaker; `<lang>` lets players pick fonts and direction per language.
    const text = escapeVtt(cue.text);
    const spoken =
      cue.language !== undefined ? `<lang ${escapeVtt(cue.language)}>${text}</lang>` : text;
    return [timing, `<v ${escapeVtt(label)}>${spoken}`, ""].join("\n");
  });
  return vtt ? ["WEBVTT", "", ...blocks].join("\n") : blocks.join("\n");
}

export function renderTranscript({
  id,
  transcript,
  format,
}: {
  id: string;
  transcript: Transcript;
  format: TranscriptFormat;
}) {
  if (format === "srt" || format === "vtt")
    return renderCues({ transcript, vtt: format === "vtt" });
  return renderParagraphs({ id, transcript, markdown: format === "md" });
}
