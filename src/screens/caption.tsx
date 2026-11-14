import { Spinner } from "@inkjs/ui";
import { Text, useBoxMetrics, useInput, useWindowSize, Box, type DOMElement } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";

import { MicrophoneSelect } from "#/components/microphone-select.js";
import { toLines, wrapUtterances, type Piece } from "#/lib/caption-layout.js";
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
      | "translation"
      | "hasApiKey"
      | "notice"
    >);

interface CaptionScreenProps {
  state: SttState;
  stateMessage?: string;
  notice?: string;
  device: string;
  languages: SttLanguage[];
  translation: SttLanguage[];
  finalTokens: Token[];
  pendingTokens: Token[];
  elapsedSeconds: number;
  overlay: CaptionOverlay;
  getHistory: () => Token[];
  journalPath?: string;
  ended?: boolean;
  finishing?: boolean;
  onTogglePause: () => void;
  onQuit: () => void;
  onOpenMicrophones: () => void;
  onOpenSettings: () => void;
  onPickMicrophone: (name: string) => void;
  onCloseOverlay: () => void;
  onSettingsPickMicrophone: (name: string) => void;
  onSettingsPickLanguages: (codes: SttLanguage[]) => void;
  onSettingsPickTranslation: (codes: SttLanguage[]) => void;
  onSettingsPickRegion: (region: SttRegion) => void;
  onSettingsChangeApiKey: (key: string) => void;
  onSettingsDeleteApiKey: () => void;
}

const CAPTION_LINE_COUNT = 6;
const END_CONFIRM_MS = 2_000;
const CAPTION_TAIL_CHARS = 1200;

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

// In order of first appearance.
function heardLanguages(tokenLists: Token[][]) {
  const heard = new Set<string>();
  for (const tokens of tokenLists) {
    for (const token of tokens) {
      if (token.language !== undefined && token.text.trim() !== "") heard.add(token.language);
    }
  }
  return [...heard];
}

function formatSpeakerIds(ids: string[]) {
  return ids.map((id) => `S${id}`).join(", ");
}

function formatElapsed(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function StatusLine(props: {
  state: SttState;
  stateMessage?: string;
  notice?: string;
  device: string;
  elapsedSeconds: number;
  focus: string[];
}) {
  return (
    <Box width="100%" justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        {/* Error text can be long, so only it may shrink; short labels stay whole. */}
        <Box flexShrink={props.state === "error" ? 1 : 0}>
          <StatusLabel state={props.state} stateMessage={props.stateMessage} />
        </Box>
        {props.focus.length > 0 && <Text dimColor>{`  focus: ${props.focus.join(", ")}`}</Text>}
        {props.notice !== undefined && <Text color="yellow">{`  ${props.notice}`}</Text>}
      </Box>
      {/* Shrinks far faster than the state side, so a long device name truncates first. */}
      <Box flexShrink={100} gap={2}>
        {props.device !== "default" && (
          <Text dimColor wrap="truncate-middle">
            {props.device}
          </Text>
        )}
        <Box flexShrink={0}>
          <Text dimColor>{formatElapsed(props.elapsedSeconds)}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function StatusLabel(props: { state: SttState; stateMessage?: string }) {
  if (props.state === "connecting") {
    return <Spinner label={props.stateMessage ?? "Connecting"} />;
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
        <Text key={index} dimColor={piece.dim} italic={piece.italic} color={piece.color}>
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
  // undefined = every language; l cycles through the languages heard so far.
  const [languageFocus, setFocusedLanguage] = useState<string | undefined>();
  // Translation always mixes languages on screen.
  const multilingual = props.languages.length > 1 || props.translation.length > 0;
  // Switching to a single language hides the l key, so drop a leftover language filter too.
  const focusedLanguage = multilingual ? languageFocus : undefined;
  // null = live view; otherwise finals frozen on entry, scrolled `offset` rows up from the bottom.
  const [history, setHistory] = useState<{ tokens: Token[]; offset: number } | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  useEffect(() => {
    if (!confirmingEnd) return;
    const timer = setTimeout(() => setConfirmingEnd(false), END_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingEnd]);

  const { utterances, captionLines } = useMemo(() => {
    const utterances = toLines({
      finalTokens: props.finalTokens,
      pendingTokens: props.pendingTokens,
      focusedSpeakers,
      focusedLanguage,
      tailChars: CAPTION_TAIL_CHARS,
    });
    return {
      utterances,
      captionLines: wrapUtterances({
        utterances,
        width: columns,
        maxLines: CAPTION_LINE_COUNT,
        showLanguage: multilingual,
      }),
    };
  }, [
    props.finalTokens,
    props.pendingTokens,
    focusedSpeakers,
    focusedLanguage,
    multilingual,
    columns,
  ]);

  const historyTokens = history?.tokens;
  const historyRows = useMemo(() => {
    if (historyTokens === undefined) return [];
    const utterances = toLines({
      finalTokens: historyTokens,
      pendingTokens: [],
      focusedSpeakers,
      focusedLanguage,
      tailChars: Infinity,
    });
    return wrapUtterances({
      utterances,
      width: columns,
      maxLines: Infinity,
      showLanguage: multilingual,
    });
  }, [historyTokens, focusedSpeakers, focusedLanguage, multilingual, columns]);

  const showPath = props.journalPath !== undefined && (props.ended || props.state === "paused");
  const historyBoxRef = useRef<DOMElement>(null);
  const historyBox = useBoxMetrics(historyBoxRef);
  const historyHeight =
    historyBox.hasMeasured && historyBox.height > 0
      ? historyBox.height
      : Math.max(CAPTION_LINE_COUNT, rows - (showPath ? 3 : 2));
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
      setFocusedLanguage(undefined);
      return;
    }
    if (input === "l" && multilingual) {
      const heard = heardLanguages([props.getHistory(), props.pendingTokens]);
      const cycle = heard.length > 0 ? heard : props.languages;
      const index = focusedLanguage === undefined ? -1 : cycle.indexOf(focusedLanguage);
      setFocusedLanguage(cycle[index + 1]);
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
      if (confirmingEnd) props.onQuit();
      else setConfirmingEnd(true);
      return;
    }
    if (input === "m") props.onOpenMicrophones();
    if (input === "s") props.onOpenSettings();
  });

  const focusedSpeakerIds = sortSpeakerIds(focusedSpeakers);
  const focus = [
    ...focusedSpeakerIds.map((id) => `S${id}`),
    ...(focusedLanguage !== undefined ? [focusedLanguage] : []),
  ];
  const focusEmpty = focus.length > 0 && utterances.length === 0 && !props.ended;
  const heardIds =
    focusEmpty && focusedSpeakers.size > 0
      ? heardSpeakerIds([props.finalTokens, props.pendingTokens])
      : [];
  const hints =
    history !== null
      ? `History ${top + 1}-${Math.min(top + historyHeight, historyRows.length)}/${historyRows.length}  Up/Down PgUp/PgDn scroll  End live`
      : props.finishing
        ? "Saving transcript  ESC force quit"
        : props.ended
          ? "Up history  ESC quit"
          : confirmingEnd
            ? "Press ESC again to end the session"
            : `p ${props.state === "paused" ? "resume" : "pause"}  1-9 speaker  ${multilingual ? "l language  " : ""}0 all  Up history  m mic  s settings  ESC end`;

  return (
    <Box flexDirection="column" height={rows} justifyContent="flex-end">
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
          onPickTranslation={props.onSettingsPickTranslation}
          onPickRegion={props.onSettingsPickRegion}
          onChangeApiKey={props.onSettingsChangeApiKey}
          onDeleteApiKey={props.onSettingsDeleteApiKey}
          onExit={props.onCloseOverlay}
        />
      ) : history !== null ? (
        <Box
          ref={historyBoxRef}
          flexDirection="column"
          flexGrow={1}
          flexBasis={0}
          overflow="hidden"
          justifyContent="flex-end"
        >
          {historyRows.slice(top, top + historyHeight).map((line, index) => (
            <CaptionRow key={top + index} line={line} />
          ))}
        </Box>
      ) : (
        <Box flexDirection="column" height={CAPTION_LINE_COUNT} justifyContent="flex-end">
          {focusEmpty ? (
            <Text dimColor>
              {`No speech from ${focus.join(", ")}${
                heardIds.length > 0 ? `, heard ${formatSpeakerIds(heardIds)}` : ""
              }. Press 0 to show all`}
            </Text>
          ) : (
            captionLines.map((line, index) => <CaptionRow key={index} line={line} />)
          )}
        </Box>
      )}

      {showPath && <Text color="yellow">{shortPath(props.journalPath!)} copied to clipboard</Text>}
      <StatusLine
        state={props.ended ? "stopped" : props.state}
        stateMessage={props.stateMessage}
        notice={props.notice}
        device={props.device}
        elapsedSeconds={props.elapsedSeconds}
        focus={focus}
      />
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
