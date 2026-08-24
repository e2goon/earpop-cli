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

const CAPTION_LINE_COUNT = 4;
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

interface Segment {
  text: string;
  dim?: boolean;
  color?: SpeakerColor;
}

interface Piece {
  text: string;
  dim: boolean;
  color?: SpeakerColor;
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

function hasCaptionText(segments: Segment[]) {
  return segments.some((segment) => segment.color === undefined && segment.text.length > 0);
}

function SpeakerIdList(props: { ids: string[] }) {
  return props.ids.map((id, index) => (
    <Text key={id}>
      {index > 0 ? <Text dimColor>, </Text> : null}
      <Text color={speakerColor(id)}>{`S${id}`}</Text>
    </Text>
  ));
}

function buildSegments({
  finalTokens,
  pendingTokens,
  focusedSpeakers,
}: {
  finalTokens: Token[];
  pendingTokens: Token[];
  focusedSpeakers: ReadonlySet<string>;
}) {
  const segments: Segment[] = [];
  let lastSpeaker: string | undefined;

  const push = ({ token, dim }: { token: Token; dim: boolean }) => {
    if (!speakerAllowed({ speaker: token.speaker, focusedSpeakers })) return;
    if (token.speaker !== undefined && token.speaker !== lastSpeaker) {
      segments.push({
        text: lastSpeaker === undefined ? `[S${token.speaker}] ` : ` [S${token.speaker}] `,
        dim,
        color: speakerColor(token.speaker),
      });
      lastSpeaker = token.speaker;
    }
    segments.push({ text: token.text, dim });
  };

  const finalTail: Token[] = [];
  let used = 0;
  for (let i = finalTokens.length - 1; i >= 0 && used < CAPTION_TAIL_CHARS; i -= 1) {
    finalTail.unshift(finalTokens[i]!);
    used += finalTokens[i]!.text.length;
  }
  for (const token of finalTail) {
    push({ token, dim: false });
  }
  for (const token of pendingTokens) {
    push({ token, dim: true });
  }

  return segments;
}

function wrapSegments({ segments, width }: { segments: Segment[]; width: number }) {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let lineWidth = 0;

  const newLine = () => {
    if (line.length > 0) lines.push(line);
    line = [];
    lineWidth = 0;
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
    appendPiece({ text, dim, color });
  };

  for (const segment of segments) {
    const units = segment.text.match(/\s+|\S+/g) ?? [];
    for (const unit of units) {
      const unitWidth = stringWidth(unit);

      if (unitWidth > width) {
        newLine();
        let chunk = "";
        let chunkWidth = 0;
        for (const char of unit) {
          const charWidthValue = charWidth(char.codePointAt(0) ?? 0);
          if (lineWidth + chunkWidth + charWidthValue > width) {
            appendText({ text: chunk, dim: segment.dim ?? false, color: segment.color });
            newLine();
            chunk = "";
            chunkWidth = 0;
          }
          chunk += char;
          chunkWidth += charWidthValue;
        }
        appendText({ text: chunk, dim: segment.dim ?? false, color: segment.color });
        continue;
      }

      if (lineWidth + unitWidth > width) {
        newLine();
        if (/^\s+$/.test(unit)) continue;
      }
      appendText({ text: unit, dim: segment.dim ?? false, color: segment.color });
    }
  }
  newLine();

  return lines.slice(-CAPTION_LINE_COUNT);
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
          <Text dimColor>
            {" · focus: "}
            <SpeakerIdList ids={props.focusedSpeakers} />
          </Text>
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

  const segments = buildSegments({
    finalTokens: props.finalTokens,
    pendingTokens: props.pendingTokens,
    focusedSpeakers,
  });
  const captionLines = wrapSegments({ segments, width: columns });
  const showPath = props.journalPath !== undefined && (props.ended || props.state === "paused");
  const focusedSpeakerIds = formatFocusLabel(focusedSpeakers);
  const focusEmpty =
    focusedSpeakers.size > 0 && !hasCaptionText(segments) && !props.ended;
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
        <Box flexDirection="column" height={CAPTION_LINE_COUNT}>
          {focusEmpty ? (
            <Text dimColor>
              No speech from <SpeakerIdList ids={focusedSpeakerIds ?? []} />
              {heardIds.length > 0 ? (
                <>
                  {" · heard "}
                  <SpeakerIdList ids={heardIds} />
                </>
              ) : null}
              {" · 0 show all"}
            </Text>
          ) : (
            captionLines.map((line, index) => (
              <Text key={index}>
                {line.map((piece, pieceIndex) => (
                  <Text key={pieceIndex} dimColor={piece.dim} color={piece.color}>
                    {piece.text}
                  </Text>
                ))}
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
