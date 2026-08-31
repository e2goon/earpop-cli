import { Spinner } from "@inkjs/ui";
import { Text, useInput, useStdout, Box } from "ink";
import { useState } from "react";

import { MicrophoneSelect } from "#/components/microphone-select.js";
import { shortPath } from "#/lib/clipboard.js";
import type { SttLanguage } from "#/lib/languages.js";
import type { Microphone, SttRegion, SttState, Token } from "#/lib/types.js";
import { SettingsScreen } from "#/screens/settings.js";

export type CaptionOverlay =
  | { kind: "none" }
  | { kind: "mic"; microphones: Microphone[]; loading: boolean; error?: string }
  | {
      kind: "settings";
      microphones: Microphone[];
      microphonesLoading: boolean;
      currentMicrophone?: string;
      region?: SttRegion;
      languages: SttLanguage[];
      hasApiKey: boolean;
      notice?: string;
    };

export interface CaptionScreenProps {
  state: SttState;
  stateMessage?: string;
  device: string;
  finalTokens: Token[];
  pendingTokens: Token[];
  elapsedSeconds: number;
  overlay: CaptionOverlay;
  journalPath?: string;
  ended?: boolean;
  onTogglePause: () => void;
  onQuit: () => void;
  onOpenMicrophones: () => void;
  onOpenSettings: () => void;
  onPickMicrophone: (name: string) => void;
  onCloseMicrophones: () => void;
  onCloseSettings: () => void;
  onSettingsPickMicrophone: (name: string) => void;
  onSettingsPickLanguages: (codes: SttLanguage[]) => void;
  onSettingsPickRegion: (region: SttRegion) => void;
  onSettingsChangeApiKey: (key: string) => void;
  onSettingsDeleteApiKey: () => void;
}

const CAPTION_LINE_COUNT = 6;
const CAPTION_TAIL_CHARS = 1200;
const FALLBACK_COLUMNS = 80;

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

function speakerColor(speaker: string): SpeakerColor | undefined {
  const index = Number(speaker);
  if (!Number.isInteger(index) || index < 1 || index > 9) return undefined;
  return SPEAKER_COLORS[index - 1];
}

// CJK / fullwidth glyphs take two terminal columns; ignore that and lines wrap wrong.
function charWidth(code: number) {
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function stringWidth(text: string) {
  let width = 0;
  for (const char of text) {
    width += charWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

function speakerAllowed({
  speaker,
  focusedSpeakers,
}: {
  speaker: string | undefined;
  focusedSpeakers: ReadonlySet<string>;
}) {
  if (focusedSpeakers.size === 0) return true;
  return speaker !== undefined && focusedSpeakers.has(speaker);
}

function formatFocusLabel(focusedSpeakers: ReadonlySet<string>) {
  if (focusedSpeakers.size === 0) return undefined;
  return [...focusedSpeakers].sort((a, b) => Number(a) - Number(b));
}

function heardSpeakerIds(tokens: Token[]) {
  const heard = new Set<string>();
  for (const token of tokens) {
    if (token.speaker !== undefined) heard.add(token.speaker);
  }
  return [...heard].sort((a, b) => Number(a) - Number(b));
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
}: {
  finalTokens: Token[];
  pendingTokens: Token[];
  focusedSpeakers: ReadonlySet<string>;
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
    if (!speakerAllowed({ speaker: token.speaker, focusedSpeakers })) return;
    const next = token.speaker;
    if ((closed || (next !== undefined && next !== speaker)) && (stable !== "" || tail !== "")) {
      push();
    }
    if (next !== undefined) speaker = next;
    if (pending) tail += token.text;
    else stable += token.text;
    closed = endsSentence(token.text);
  };

  const finalTail: Token[] = [];
  let used = 0;
  for (let i = finalTokens.length - 1; i >= 0 && used < CAPTION_TAIL_CHARS; i -= 1) {
    finalTail.unshift(finalTokens[i]!);
    used += finalTokens[i]!.text.length;
  }
  for (const token of finalTail) {
    eat({ token, pending: false });
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

  const appendText = ({
    text,
    dim,
    color,
  }: {
    text: string;
    dim: boolean;
    color?: SpeakerColor;
  }) => {
    if (text.length === 0) return;
    appendPiece({ text, dim, ...(color !== undefined ? { color } : {}) });
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
        for (const char of unit) {
          const charWidthValue = charWidth(char.codePointAt(0) ?? 0);
          if (lineWidth + chunkWidth + charWidthValue > width) {
            appendText({ text: chunk, dim: piece.dim, color: piece.color });
            newLine(true);
            chunk = "";
            chunkWidth = 0;
          }
          chunk += char;
          chunkWidth += charWidthValue;
        }
        appendText({ text: chunk, dim: piece.dim, color: piece.color });
        continue;
      }

      if (lineWidth + unitWidth > width) {
        newLine(true);
        if (/^\s+$/.test(unit)) continue;
      }
      appendText({ text: unit, dim: piece.dim, color: piece.color });
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
  const rows: { pieces: Piece[]; tag?: Piece }[] = [];

  for (const utterance of utterances) {
    const pieces: Piece[] = [];
    let tag: Piece | undefined;
    let indent = 0;
    if (utterance.speaker !== undefined) {
      const color = speakerColor(utterance.speaker);
      tag = {
        text: `[S${utterance.speaker}] `,
        dim: false,
        tag: true,
        ...(color !== undefined ? { color } : {}),
      };
      indent = stringWidth(tag.text);
      pieces.push(tag);
    }
    const stable = utterance.stable.trimStart();
    const pending = stable.length === 0 ? utterance.pending.trimStart() : utterance.pending;
    if (stable.length > 0) pieces.push({ text: stable, dim: false });
    if (pending.length > 0) pieces.push({ text: pending, dim: true });

    for (const wrapped of wrapFlow({ pieces, width, indent })) {
      rows.push({ pieces: wrapped, tag });
    }
  }

  const kept = rows.slice(-maxLines);
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
    const chars = [...piece.text];
    let start = chars.length;
    let used = 0;
    while (start > 0) {
      const cw = charWidth(chars[start - 1]!.codePointAt(0) ?? 0);
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
  focusedSpeakers?: string[];
}) {
  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <StatusLabel state={props.state} stateMessage={props.stateMessage} />
        {props.focusedSpeakers !== undefined && props.focusedSpeakers.length > 0 && (
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

export function CaptionScreen(props: CaptionScreenProps) {
  const { stdout } = useStdout();
  const columns = stdout.columns ?? FALLBACK_COLUMNS;
  const overlayOpen = props.overlay.kind !== "none";
  // Empty set = show all speakers; 1–9 toggles membership, 0 clears.
  const [focusedSpeakers, setFocusedSpeakers] = useState(() => new Set<string>());

  useInput((input, key) => {
    if (overlayOpen) return;

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

  const utterances = toLines({
    finalTokens: props.finalTokens,
    pendingTokens: props.pendingTokens,
    focusedSpeakers,
  });
  const captionLines = wrapUtterances({
    utterances,
    width: columns,
    maxLines: CAPTION_LINE_COUNT,
  });
  const showPath = props.journalPath !== undefined && (props.ended || props.state === "paused");
  const focusedSpeakerIds = formatFocusLabel(focusedSpeakers);
  const focusEmpty = focusedSpeakers.size > 0 && utterances.length === 0 && !props.ended;
  const heardIds = heardSpeakerIds([...props.finalTokens, ...props.pendingTokens]);
  const liveHints =
    props.state === "paused"
      ? "p resume · 1-9 speaker · 0 all · m mic · s settings · ESC end"
      : "p pause · 1-9 speaker · 0 all · m mic · s settings · ESC end";

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
          onCancel={props.onCloseMicrophones}
        />
      ) : props.overlay.kind === "settings" ? (
        <SettingsScreen
          microphones={props.overlay.microphones}
          microphonesLoading={props.overlay.microphonesLoading}
          currentMicrophone={props.overlay.currentMicrophone}
          region={props.overlay.region}
          languages={props.overlay.languages}
          hasApiKey={props.overlay.hasApiKey}
          notice={props.overlay.notice}
          exitLabel="ESC back"
          onPickMicrophone={props.onSettingsPickMicrophone}
          onPickLanguages={props.onSettingsPickLanguages}
          onPickRegion={props.onSettingsPickRegion}
          onChangeApiKey={props.onSettingsChangeApiKey}
          onDeleteApiKey={props.onSettingsDeleteApiKey}
          onExit={props.onCloseSettings}
        />
      ) : (
        <Box flexDirection="column" height={CAPTION_LINE_COUNT} justifyContent="flex-end">
          {focusEmpty ? (
            <Text dimColor>
              {`No speech from ${formatSpeakerIds(focusedSpeakerIds ?? [])}${
                heardIds.length > 0 ? ` · heard ${formatSpeakerIds(heardIds)}` : ""
              } · 0 show all`}
            </Text>
          ) : (
            captionLines.map((line, index) => (
              <Text key={index}>
                {line.map((piece, pieceIndex) =>
                  piece.color !== undefined ? (
                    <Text key={pieceIndex} dimColor={piece.dim} color={piece.color}>
                      {piece.text}
                    </Text>
                  ) : (
                    <Text key={pieceIndex} dimColor={piece.dim}>
                      {piece.text}
                    </Text>
                  ),
                )}
              </Text>
            ))
          )}
        </Box>
      )}

      {!overlayOpen && (
        <Box width="100%">
          <Text dimColor>{props.ended ? "ESC quit" : liveHints}</Text>
        </Box>
      )}
    </Box>
  );
}
