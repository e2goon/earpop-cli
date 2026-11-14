import stringWidth from "string-width";

import { NO_SPACE_SCRIPT } from "#/lib/languages.js";
import { PAUSE_BREAK_MS, sentenceMark, startsNewWord } from "#/lib/segments.js";
import type { Token } from "#/lib/types.js";

/** Fixed palette for speaker tags S1–S9 (Ink named colors). */
const SPEAKER_COLORS = [
  "cyan",
  "yellow",
  "magenta",
  "green",
  "blue",
  "red",
  "white",
  "cyanBright",
  "yellowBright",
] as const;

type SpeakerColor = (typeof SPEAKER_COLORS)[number];

interface Utterance {
  speaker?: string;
  language?: string;
  translation?: boolean;
  stable: string;
  pending: string;
}

export interface Piece {
  text: string;
  dim: boolean;
  italic?: boolean;
  color?: SpeakerColor;
  tag?: boolean;
}

function speakerColor(speaker: string) {
  const index = Number(speaker);
  if (!Number.isInteger(index) || index < 1 || index > 9) return undefined;
  return SPEAKER_COLORS[index - 1];
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string) {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

// Line-break opportunities: whitespace runs, words, and dictionary words inside unspaced scripts
// (Japanese, Chinese, Thai). Punctuation stays glued to the word before it.
function breakUnits(text: string) {
  const units: string[] = [];
  for (const run of text.match(/\s+|\S+/g) ?? []) {
    if (/^\s/.test(run) || !NO_SPACE_SCRIPT.test(run)) {
      units.push(run);
      continue;
    }
    let previous = "";
    for (const { segment, isWordLike } of wordSegmenter.segment(run)) {
      if (isWordLike !== true && previous !== "") {
        previous += segment;
        units[units.length - 1] = previous;
        continue;
      }
      previous = segment;
      units.push(segment);
    }
  }
  return units;
}

export function toLines({
  finalTokens,
  pendingTokens,
  focusedSpeakers,
  focusedLanguage,
  tailChars,
}: {
  finalTokens: Token[];
  pendingTokens: Token[];
  focusedSpeakers: ReadonlySet<string>;
  focusedLanguage?: string;
  tailChars: number;
}) {
  const lines: Utterance[] = [];
  let speaker: string | undefined;
  let language: string | undefined;
  let translation = false;
  let stable = "";
  let tail = "";
  let closed = false;
  let afterPeriod = false;
  let lastEndMs: number | undefined;

  const push = () => {
    if (stable.trim() === "" && tail.trim() === "") return;
    lines.push({
      speaker,
      language,
      ...(translation ? { translation: true } : {}),
      stable,
      pending: tail,
    });
    language = undefined;
    stable = "";
    tail = "";
    closed = false;
    afterPeriod = false;
  };

  const eat = ({ token, pending }: { token: Token; pending: boolean }) => {
    if (
      focusedSpeakers.size > 0 &&
      (token.speaker === undefined || !focusedSpeakers.has(token.speaker))
    ) {
      return;
    }
    if (focusedLanguage !== undefined && token.language !== focusedLanguage) return;
    const blank = token.text.trim() === "";
    const next = token.speaker;
    const translated = token.translation === true;
    const paused =
      token.startMs !== undefined &&
      lastEndMs !== undefined &&
      token.startMs - lastEndMs > PAUSE_BREAK_MS;
    if (
      closed ||
      paused ||
      (afterPeriod && startsNewWord(token.text)) ||
      (next !== undefined && next !== speaker) ||
      // Translations arrive right after the speech they translate; give them their own line.
      (!blank && (stable !== "" || tail !== "") && translated !== translation) ||
      // Soniox keeps a sentence in one language, so a language switch starts a new line.
      (!blank &&
        language !== undefined &&
        token.language !== undefined &&
        token.language !== language)
    ) {
      push();
    }
    if (next !== undefined) speaker = next;
    if (!blank && language === undefined) language = token.language;
    if (!blank) translation = translated;
    if (pending) tail += token.text;
    else stable += token.text;
    if (token.endMs !== undefined) lastEndMs = token.endMs;
    if (!blank) {
      const mark = sentenceMark(token.text);
      closed = mark === "end";
      afterPeriod = mark === "period";
    }
  };

  let start = finalTokens.length;
  for (let used = 0; start > 0 && used < tailChars; start -= 1) {
    used += finalTokens[start - 1]!.text.length;
  }
  for (let i = start; i < finalTokens.length; i += 1) {
    eat({ token: finalTokens[i]!, pending: false });
  }
  for (const token of pendingTokens) {
    eat({ token, pending: true });
  }
  push();
  return lines;
}

function wrapFlow({ pieces, width, indent }: { pieces: Piece[]; width: number; indent: number }) {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let lineWidth = 0;

  const padOnly = () => indent > 0 && line.length === 1 && line[0]!.text.trim() === "";

  const newLine = (continuation: boolean) => {
    if (line.length > 0 && !padOnly()) lines.push(line);
    line = [];
    lineWidth = 0;
    if (continuation && indent > 0) {
      line.push({ text: " ".repeat(indent), dim: false });
      lineWidth = indent;
    }
  };

  const appendPiece = ({ piece, pieceWidth }: { piece: Piece; pieceWidth: number }) => {
    line.push(piece);
    lineWidth += pieceWidth;
  };

  const appendText = ({
    text,
    textWidth,
    piece,
  }: {
    text: string;
    textWidth: number;
    piece: Piece;
  }) => {
    if (text.length > 0) {
      appendPiece({
        piece: { text, dim: piece.dim, italic: piece.italic, color: piece.color },
        pieceWidth: textWidth,
      });
    }
  };

  const atLineStart = () => {
    const last = line.at(-1);
    return lineWidth === 0 || padOnly() || last?.tag === true;
  };

  for (const piece of pieces) {
    if (piece.tag === true) {
      appendPiece({ piece, pieceWidth: stringWidth(piece.text) });
      continue;
    }

    for (const unit of breakUnits(piece.text)) {
      const blank = /^\s+$/.test(unit);
      if (blank && atLineStart()) continue;

      const unitWidth = stringWidth(unit);
      // Never leave a speaker tag or indent alone on a row: a unit that cannot fit even there is split.
      if (lineWidth + unitWidth > width && !atLineStart()) {
        newLine(true);
        if (blank) continue;
      }
      if (lineWidth + unitWidth <= width) {
        appendText({ text: unit, textWidth: unitWidth, piece });
        continue;
      }

      let chunk = "";
      let chunkWidth = 0;
      for (const char of graphemes(unit)) {
        const charWidthValue = stringWidth(char);
        if (chunk !== "" && lineWidth + chunkWidth + charWidthValue > width) {
          appendText({ text: chunk, textWidth: chunkWidth, piece });
          newLine(true);
          chunk = "";
          chunkWidth = 0;
        }
        chunk += char;
        chunkWidth += charWidthValue;
      }
      appendText({ text: chunk, textWidth: chunkWidth, piece });
    }
  }
  newLine(false);
  return lines;
}

export function wrapUtterances({
  utterances,
  width,
  maxLines,
  showLanguage = false,
}: {
  utterances: Utterance[];
  width: number;
  maxLines: number;
  showLanguage?: boolean;
}) {
  const chunks: { pieces: Piece[]; tag?: Piece }[][] = [];
  let rowCount = 0;

  for (let u = utterances.length - 1; u >= 0 && rowCount < maxLines; u -= 1) {
    const utterance = utterances[u]!;
    const pieces: Piece[] = [];
    let tag: Piece | undefined;
    let indent = 0;
    const labels = [
      utterance.speaker !== undefined ? `S${utterance.speaker}` : undefined,
      showLanguage ? utterance.language : undefined,
    ].filter((label) => label !== undefined);
    if (labels.length > 0) {
      tag = {
        text: `[${labels.join(" ")}] `,
        dim: false,
        tag: true,
        color: utterance.speaker !== undefined ? speakerColor(utterance.speaker) : undefined,
      };
      indent = stringWidth(tag.text);
      pieces.push(tag);
    }
    const stable = utterance.stable.trimStart();
    const pending = stable.length === 0 ? utterance.pending.trimStart() : utterance.pending;
    const italic = utterance.translation === true;
    if (stable.length > 0) pieces.push({ text: stable, dim: false, italic });
    if (pending.length > 0) pieces.push({ text: pending, dim: true, italic });

    const chunk = wrapFlow({ pieces, width, indent }).map((wrapped) => ({ pieces: wrapped, tag }));
    chunks.push(chunk);
    rowCount += chunk.length;
  }

  const kept = chunks.reverse().flat().slice(-maxLines);
  if (kept.length === 0) return [];

  const first = kept[0]!;
  if (first.tag === undefined || first.pieces[0]?.tag === true) {
    return kept.map((row) => row.pieces);
  }

  const tagWidth = stringWidth(first.tag.text);
  const bodyWidth = width - tagWidth;
  if (bodyWidth <= 0) return [[first.tag], ...kept.slice(1).map((row) => row.pieces)];

  const source =
    first.pieces[0] !== undefined && /^\s+$/.test(first.pieces[0].text)
      ? first.pieces.slice(1)
      : first.pieces;
  const body: Piece[] = [];
  let remaining = bodyWidth;
  for (let i = source.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const piece = source[i]!;
    const pieceWidth = stringWidth(piece.text);
    if (pieceWidth <= remaining) {
      body.unshift(piece);
      remaining -= pieceWidth;
      continue;
    }
    const chars = graphemes(piece.text);
    let start = chars.length;
    let used = 0;
    while (start > 0) {
      const cw = stringWidth(chars[start - 1]!);
      if (used + cw > remaining) break;
      used += cw;
      start -= 1;
    }
    if (start < chars.length) {
      body.unshift({ ...piece, text: chars.slice(start).join("") });
    }
    remaining = 0;
  }

  return [[first.tag, ...body], ...kept.slice(1).map((row) => row.pieces)];
}
