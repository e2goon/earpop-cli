import { Spinner } from "@inkjs/ui";
import { Text, useInput, useWindowSize, Box } from "ink";
import { useMemo, useState } from "react";
import stringWidth from "string-width";

import { MicrophoneSelect } from "#/components/microphone-select.js";
import { shortPath } from "#/lib/clipboard.js";
import type { SttLanguage } from "#/lib/languages.js";
import type { Microphone, SttRegion, SttState, Token } from "#/lib/types.js";
import { SettingsScreen, type SettingsScreenProps } from "#/screens/settings.js";

export type CaptionOverlay =
  | { kind: "none" }
  | { kind: "mic"; microphones: Microphone[]; loading: boolean; error?: string }
  | ({ kind: "settings" } & Pick<
      SettingsScreenProps,
      | "microphones"
      | "microphonesLoading"
      | "currentMicrophone"
      | "region"
      | "languages"
      | "hasApiKey"
      | "notice"
    >);

interface CaptionScreenProps {
  state: SttState;
  stateMessage?: string;
  device: string;
  finalTokens: Token[];
  pendingTokens: Token[];
  elapsedSeconds: number;
  overlay: CaptionOverlay;
  getHistory: () => Token[];
  journalPath?: string;
  ended?: boolean;
  onTogglePause: () => void;
  onQuit: () => void;
  onOpenMicrophones: () => void;
  onOpenSettings: () => void;
  onPickMicrophone: (name: string) => void;
  onCloseOverlay: () => void;
  onSettingsPickMicrophone: (name: string) => void;
  onSettingsPickLanguages: (codes: SttLanguage[]) => void;
  onSettingsPickRegion: (region: SttRegion) => void;
  onSettingsChangeApiKey: (key: string) => void;
  onSettingsDeleteApiKey: () => void;
}

const CAPTION_LINE_COUNT = 6;
const CAPTION_TAIL_CHARS = 1200;

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
  stable: string;
  pending: string;
}

interface Piece {
  text: string;
  dim: boolean;
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

function sortSpeakerIds(ids: Iterable<string>) {
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

function heardSpeakerIds(tokenLists: Token[][]) {
  const heard = new Set<string>();
  for (const tokens of tokenLists) {
    for (const token of tokens) {
      if (token.speaker !== undefined) heard.add(token.speaker);
    }
  }
  return sortSpeakerIds(heard);
}

function formatSpeakerIds(ids: string[]) {
  return ids.map((id) => `S${id}`).join(", ");
}

function endsSentence(text: string) {
  const trimmed = text.trimEnd();
  if (trimmed === "") return false;

  const last = trimmed.at(-1) ?? "";
  if ("?!。？！".includes(last)) return true;

  // "1." / "Dr." stay on this line; a period only ends a sentence when the token has trailing space.
  return last === "." && text !== trimmed;
}

function toLines({
  finalTokens,
  pendingTokens,
  focusedSpeakers,
  tailChars,
}: {
  finalTokens: Token[];
  pendingTokens: Token[];
  focusedSpeakers: ReadonlySet<string>;
  tailChars: number;
}) {
  const lines: Utterance[] = [];
  let speaker: string | undefined;
  let stable = "";
  let tail = "";
  let closed = false;

  const push = () => {
    if (stable.trim() === "" && tail.trim() === "") return;
    lines.push({ speaker, stable, pending: tail });
    stable = "";
    tail = "";
    closed = false;
  };

  const eat = ({ token, pending }: { token: Token; pending: boolean }) => {
    if (
      focusedSpeakers.size > 0 &&
      (token.speaker === undefined || !focusedSpeakers.has(token.speaker))
    ) {
      return;
    }
    const next = token.speaker;
    if (closed || (next !== undefined && next !== speaker)) push();
    if (next !== undefined) speaker = next;
    if (pending) tail += token.text;
    else stable += token.text;
    closed = endsSentence(token.text);
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

  const appendPiece = (piece: Piece) => {
    line.push(piece);
    lineWidth += stringWidth(piece.text);
  };

  const appendText = ({ text, piece }: { text: string; piece: Piece }) => {
    if (text.length > 0) appendPiece({ text, dim: piece.dim, color: piece.color });
  };

  const atLineStart = () => {
    const last = line.at(-1);
    return lineWidth === 0 || padOnly() || last?.tag === true;
  };

  for (const piece of pieces) {
    if (piece.tag === true) {
      appendPiece(piece);
      continue;
    }

    const units = piece.text.match(/\s+|\S+/g) ?? [];
    for (const unit of units) {
      if (/^\s+$/.test(unit) && atLineStart()) continue;

      const unitWidth = stringWidth(unit);

      if (unitWidth > width) {
        newLine(true);
        let chunk = "";
        let chunkWidth = 0;
        for (const char of graphemes(unit)) {
          const charWidthValue = stringWidth(char);
          if (lineWidth + chunkWidth + charWidthValue > width) {
            appendText({ text: chunk, piece });
            newLine(true);
            chunk = "";
            chunkWidth = 0;
          }
          chunk += char;
          chunkWidth += charWidthValue;
        }
        appendText({ text: chunk, piece });
        continue;
      }

      if (lineWidth + unitWidth > width) {
        newLine(true);
        if (/^\s+$/.test(unit)) continue;
      }
      appendText({ text: unit, piece });
    }
  }
  newLine(false);
  return lines;
}

function wrapUtterances({
  utterances,
  width,
  maxLines,
}: {
  utterances: Utterance[];
  width: number;
  maxLines: number;
}) {
  const chunks: { pieces: Piece[]; tag?: Piece }[][] = [];
  let rowCount = 0;

  for (let u = utterances.length - 1; u >= 0 && rowCount < maxLines; u -= 1) {
    const utterance = utterances[u]!;
    const pieces: Piece[] = [];
    let tag: Piece | undefined;
    let indent = 0;
    if (utterance.speaker !== undefined) {
      tag = {
        text: `[S${utterance.speaker}] `,
        dim: false,
        tag: true,
        color: speakerColor(utterance.speaker),
      };
      indent = stringWidth(tag.text);
      pieces.push(tag);
    }
    const stable = utterance.stable.trimStart();
    const pending = stable.length === 0 ? utterance.pending.trimStart() : utterance.pending;
    if (stable.length > 0) pieces.push({ text: stable, dim: false });
    if (pending.length > 0) pieces.push({ text: pending, dim: true });

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

function formatElapsed(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function StatusLine(props: {
  state: SttState;
  stateMessage?: string;
  elapsedSeconds: number;
  focusedSpeakers: string[];
}) {
  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <StatusLabel state={props.state} stateMessage={props.stateMessage} />
        {props.focusedSpeakers.length > 0 && (
          <Text dimColor>{` · focus: ${formatSpeakerIds(props.focusedSpeakers)}`}</Text>
        )}
      </Box>
      <Text dimColor>{formatElapsed(props.elapsedSeconds)}</Text>
    </Box>
  );
}

function StatusLabel(props: { state: SttState; stateMessage?: string }) {
  if (props.state === "connecting") {
    return <Spinner label="Connecting" />;
  }
  if (props.state === "paused") {
    return (
      <Text>
        <Text color="yellow">‖ </Text>
        Paused
      </Text>
    );
  }
  if (props.state === "listening") {
    return (
      <Text>
        <Text color="green">● </Text>
        Listening
      </Text>
    );
  }
  if (props.state === "error") {
    return (
      <Text>
        <Text color="red">{" Error "}</Text> {props.stateMessage}
      </Text>
    );
  }
  return <Text dimColor>Stopped</Text>;
}

function CaptionRow(props: { line: Piece[] }) {
  return (
    <Text>
      {props.line.map((piece, index) => (
        <Text key={index} dimColor={piece.dim} color={piece.color}>
          {piece.text}
        </Text>
      ))}
    </Text>
  );
}

export function CaptionScreen(props: CaptionScreenProps) {
  const { columns, rows } = useWindowSize();
  const overlayOpen = props.overlay.kind !== "none";
  // Empty set = show all speakers; 1–9 toggles membership, 0 clears.
  const [focusedSpeakers, setFocusedSpeakers] = useState(() => new Set<string>());
  // null = live view; otherwise finals frozen on entry, scrolled `offset` rows up from the bottom.
  const [history, setHistory] = useState<{ tokens: Token[]; offset: number } | null>(null);

  const { utterances, captionLines } = useMemo(() => {
    const utterances = toLines({
      finalTokens: props.finalTokens,
      pendingTokens: props.pendingTokens,
      focusedSpeakers,
      tailChars: CAPTION_TAIL_CHARS,
    });
    return {
      utterances,
      captionLines: wrapUtterances({ utterances, width: columns, maxLines: CAPTION_LINE_COUNT }),
    };
  }, [props.finalTokens, props.pendingTokens, focusedSpeakers, columns]);

  const historyTokens = history?.tokens;
  const historyRows = useMemo(() => {
    if (historyTokens === undefined) return [];
    const utterances = toLines({
      finalTokens: historyTokens,
      pendingTokens: [],
      focusedSpeakers,
      tailChars: Infinity,
    });
    return wrapUtterances({ utterances, width: columns, maxLines: Infinity });
  }, [historyTokens, focusedSpeakers, columns]);

  const showPath = props.journalPath !== undefined && (props.ended || props.state === "paused");
  const historyHeight = Math.max(CAPTION_LINE_COUNT, rows - (showPath ? 3 : 2));
  const maxOffset = Math.max(0, historyRows.length - historyHeight);
  const offset = Math.min(history?.offset ?? 0, maxOffset);
  const top = Math.max(0, historyRows.length - historyHeight - offset);
  const page = historyHeight - 1;

  const scrollUp = (delta: number) => {
    if (history === null) {
      if (delta <= 0) return;
      const tokens = props.getHistory();
      if (tokens.length > 0) setHistory({ tokens: tokens.slice(), offset: delta - 1 });
      return;
    }
    const next = offset + delta;
    setHistory(next < 0 ? null : { ...history, offset: Math.min(next, maxOffset) });
  };

  useInput((input, key) => {
    if (overlayOpen) return;

    if (key.upArrow) return scrollUp(1);
    if (key.downArrow) return scrollUp(-1);
    if (key.pageUp) return scrollUp(page);
    if (key.pageDown) return scrollUp(-page);
    if (key.home) return scrollUp(Infinity);
    if (history !== null && (key.end || key.escape)) {
      setHistory(null);
      return;
    }

    if (props.ended) {
      if (key.escape) props.onQuit();
      return;
    }

    if (input === "0") {
      setFocusedSpeakers(new Set());
      return;
    }
    if (/^[1-9]$/.test(input)) {
      setFocusedSpeakers((prev) => {
        const next = new Set(prev);
        if (next.has(input)) next.delete(input);
        else next.add(input);
        return next;
      });
      return;
    }

    if (input === "p") {
      props.onTogglePause();
      return;
    }
    if (key.escape) {
      props.onQuit();
      return;
    }
    if (input === "m") props.onOpenMicrophones();
    if (input === "s") props.onOpenSettings();
  });

  const focusedSpeakerIds = sortSpeakerIds(focusedSpeakers);
  const focusEmpty = focusedSpeakers.size > 0 && utterances.length === 0 && !props.ended;
  const heardIds = focusEmpty ? heardSpeakerIds([props.finalTokens, props.pendingTokens]) : [];
  const hints =
    history !== null
      ? `History ${top + 1}-${Math.min(top + historyHeight, historyRows.length)}/${historyRows.length}  Up/Down PgUp/PgDn scroll  End live`
      : props.ended
        ? "Up history  ESC quit"
        : `p ${props.state === "paused" ? "resume" : "pause"}  1-9 speaker  0 all  Up history  m mic  s settings  ESC end`;

  return (
    <Box flexDirection="column">
      <StatusLine
        state={props.ended ? "stopped" : props.state}
        stateMessage={props.stateMessage}
        elapsedSeconds={props.elapsedSeconds}
        focusedSpeakers={focusedSpeakerIds}
      />

      {showPath && <Text color="yellow">{shortPath(props.journalPath!)} copied to clipboard</Text>}

      {props.overlay.kind === "mic" ? (
        <MicrophoneSelect
          microphones={props.overlay.microphones}
          current={props.device}
          loading={props.overlay.loading}
          error={props.overlay.error}
          onPick={props.onPickMicrophone}
          onCancel={props.onCloseOverlay}
        />
      ) : props.overlay.kind === "settings" ? (
        <SettingsScreen
          {...props.overlay}
          exitLabel="ESC back"
          onPickMicrophone={props.onSettingsPickMicrophone}
          onPickLanguages={props.onSettingsPickLanguages}
          onPickRegion={props.onSettingsPickRegion}
          onChangeApiKey={props.onSettingsChangeApiKey}
          onDeleteApiKey={props.onSettingsDeleteApiKey}
          onExit={props.onCloseOverlay}
        />
      ) : history !== null ? (
        <Box flexDirection="column" height={historyHeight} justifyContent="flex-end">
          {historyRows.slice(top, top + historyHeight).map((line, index) => (
            <CaptionRow key={top + index} line={line} />
          ))}
        </Box>
      ) : (
        <Box flexDirection="column" height={CAPTION_LINE_COUNT} justifyContent="flex-end">
          {focusEmpty ? (
            <Text dimColor>
              {`No speech from ${formatSpeakerIds(focusedSpeakerIds)}${
                heardIds.length > 0 ? ` · heard ${formatSpeakerIds(heardIds)}` : ""
              } · 0 show all`}
            </Text>
          ) : (
            captionLines.map((line, index) => <CaptionRow key={index} line={line} />)
          )}
        </Box>
      )}

      {!overlayOpen && (
        <Box width="100%">
          <Text dimColor wrap="truncate-end">
            {hints}
          </Text>
        </Box>
      )}
    </Box>
  );
}
