import { Spinner } from "@inkjs/ui";
import { Text, useInput, useStdout, Box } from "ink";

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

interface Segment {
  text: string;
  dim?: boolean;
}

interface Piece {
  text: string;
  dim: boolean;
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

function buildSegments({
  finalTokens,
  pendingTokens,
}: {
  finalTokens: Token[];
  pendingTokens: Token[];
}) {
  const segments: Segment[] = [];
  // Temporary: show diarization labels so ambient TV vs near-mic speech can be compared.
  let lastSpeaker: string | undefined;

  const push = ({ token, dim }: { token: Token; dim: boolean }) => {
    if (token.speaker !== undefined && token.speaker !== lastSpeaker) {
      segments.push({
        text: lastSpeaker === undefined ? `[S${token.speaker}] ` : ` [S${token.speaker}] `,
        dim,
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

  const appendText = ({ text, dim }: { text: string; dim: boolean }) => {
    if (text.length === 0) return;
    appendPiece({ text, dim });
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
            appendText({ text: chunk, dim: segment.dim ?? false });
            newLine();
            chunk = "";
            chunkWidth = 0;
          }
          chunk += char;
          chunkWidth += charWidthValue;
        }
        appendText({ text: chunk, dim: segment.dim ?? false });
        continue;
      }

      if (lineWidth + unitWidth > width) {
        newLine();
        if (/^\s+$/.test(unit)) continue;
      }
      appendText({ text: unit, dim: segment.dim ?? false });
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

function StatusLine(props: { state: SttState; stateMessage?: string; elapsedSeconds: number }) {
  return (
    <Box width="100%" justifyContent="space-between">
      <StatusLabel state={props.state} stateMessage={props.stateMessage} />
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

  useInput((input, key) => {
    if (overlayOpen) return;

    if (props.ended) {
      if (key.escape) props.onQuit();
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
  });
  const captionLines = wrapSegments({ segments, width: columns });
  const showPath = props.journalPath !== undefined && (props.ended || props.state === "paused");

  return (
    <Box flexDirection="column">
      <StatusLine
        state={props.ended ? "stopped" : props.state}
        stateMessage={props.stateMessage}
        elapsedSeconds={props.elapsedSeconds}
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
          {captionLines.map((line, index) => (
            <Text key={index}>
              {line.map((piece, pieceIndex) => (
                <Text key={pieceIndex} dimColor={piece.dim}>
                  {piece.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      )}

      {!overlayOpen && (
        <Box width="100%">
          <Text dimColor>
            {props.ended
              ? "ESC quit"
              : props.state === "paused"
                ? "p resume · m mic · s settings · ESC end"
                : "p pause · m mic · s settings · ESC end"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
