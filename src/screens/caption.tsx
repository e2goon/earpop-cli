import { Spinner } from "@inkjs/ui";
import { Box, Static, Text, useInput, useWindowSize } from "ink";
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";

import { MicrophoneSelect } from "#/components/microphone-select.js";
import {
  toLines,
  wrapUtterances,
  type CommittedUtterance,
  type Piece,
} from "#/lib/caption-layout.js";
import { copyInBackground, shortPath } from "#/lib/clipboard.js";
import { fitHints, latinKey, type KeyHint } from "#/lib/keys.js";
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
  committed: CommittedUtterance[];
  finalTokens: Token[];
  pendingTokens: Token[];
  elapsedSeconds: number;
  overlay: CaptionOverlay;
  onFilterChange: (filter: { speakers: ReadonlySet<string>; language?: string }) => void;
  getHeardLanguages?: () => string[];
  journalPath?: string;
  /** Shown in red until the session ends, for problems the user must not miss. */
  warning?: string;
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

const END_CONFIRM_MS = 2_000;
const COPY_NOTICE_MS = 2_000;

const KEY_HELP: Array<[string, string]> = [
  ["p", "Pause or resume"],
  ["1-9", "Filter new lines by speaker; press again to remove"],
  ["l", "Filter new lines by language"],
  ["0", "Show everyone and every language"],
  ["c", "Copy the transcript path"],
  ["m", "Switch microphone"],
  ["s", "Settings"],
  ["ESC ESC", "End the session; ESC again quits (Ctrl+C too)"],
];

function sortSpeakerIds(ids: Iterable<string>) {
  return [...ids].sort((a, b) => Number(a) - Number(b));
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
  session: string;
  elapsedSeconds: number;
  focus: string[];
}) {
  return (
    // One row always: long notices truncate instead of jumping the live footer.
    <Box width="100%" height={1} flexShrink={0} gap={2} overflow="hidden">
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        {/* Error text can be long, so only it may shrink; short labels stay whole. */}
        <Box flexShrink={props.state === "error" ? 1 : 0}>
          <StatusLabel state={props.state} stateMessage={props.stateMessage} />
        </Box>
        {props.focus.length > 0 && (
          <Text dimColor wrap="truncate-end">{`  focus: ${props.focus.join(", ")}`}</Text>
        )}
        {props.notice !== undefined && (
          <Text color="yellow" wrap="truncate-end">{`  ${props.notice}`}</Text>
        )}
      </Box>
      {/* Shrinks far faster than the state side: the device name goes first, then languages. */}
      <Box flexShrink={100} gap={2} overflow="hidden">
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {props.session}
          </Text>
        </Box>
        {props.device !== "default" && (
          <Box flexShrink={100}>
            <Text dimColor wrap="truncate-middle">
              {props.device}
            </Text>
          </Box>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{formatElapsed(props.elapsedSeconds)}</Text>
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

function HelpPanel(props: { rows: number }) {
  const keyWidth = Math.max(...KEY_HELP.map(([key]) => key.length)) + 2;
  // Short terminals get as many keys as fit, then a pointer to the rest.
  const fits = props.rows - 1 >= KEY_HELP.length;
  const shown = fits ? KEY_HELP : KEY_HELP.slice(0, Math.max(1, props.rows - 1));
  return (
    <Box flexDirection="column" flexShrink={0}>
      {shown.map(([key, action]) => (
        <Box key={key}>
          <Box width={keyWidth} flexShrink={0}>
            <Text color="cyan">{key}</Text>
          </Box>
          <Text wrap="truncate-end">{action}</Text>
        </Box>
      ))}
      <Text dimColor wrap="truncate-end">
        {fits
          ? "Any key closes this. Hangul jamo work as the same keys."
          : "More keys in the README. Any key closes this."}
      </Text>
    </Box>
  );
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
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // A fresh object per copy, so pressing c again restarts the timer even with the same text.
  const [copyNotice, setCopyNotice] = useState<{ text: string } | undefined>();

  const syncFilter = useEffectEvent(() => {
    props.onFilterChange({ speakers: focusedSpeakers, language: focusedLanguage });
  });

  useEffect(() => {
    syncFilter();
  }, [focusedSpeakers, focusedLanguage]);

  useEffect(() => {
    if (!confirmingEnd) return;
    const timer = setTimeout(() => setConfirmingEnd(false), END_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingEnd]);

  useEffect(() => {
    if (copyNotice === undefined) return;
    const timer = setTimeout(() => setCopyNotice(undefined), COPY_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  const showPath = props.journalPath !== undefined && (props.ended || props.state === "paused");
  const hasOverlay = overlayOpen || showHelp;
  const chromeRows =
    1 + (props.warning !== undefined ? 1 : 0) + (showPath ? 1 : 0) + (!overlayOpen ? 1 : 0);
  // Keep dynamic output height strictly below `rows` so Ink never enters fullscreen erase over <Static>.
  const showLiveAboveOverlay = rows >= 14;
  const maxLiveRows = hasOverlay
    ? showLiveAboveOverlay
      ? 2
      : 0
    : Math.max(1, rows - chromeRows - 1);
  const maxOverlayBoxRows = Math.max(1, rows - chromeRows - maxLiveRows - 1);
  const overlayRows = Math.max(1, maxOverlayBoxRows - 1);

  const { utterances, captionLines } = useMemo(() => {
    const utterances = toLines({
      finalTokens: props.finalTokens,
      pendingTokens: props.pendingTokens,
      focusedSpeakers,
      focusedLanguage,
      tailChars: Infinity,
    });
    return {
      utterances,
      captionLines:
        maxLiveRows === 0
          ? []
          : wrapUtterances({
              utterances,
              width: columns,
              maxLines: maxLiveRows,
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
    maxLiveRows,
  ]);

  const copyPath = () => {
    if (props.journalPath === undefined) return;
    void copyInBackground(props.journalPath).then((copied) =>
      setCopyNotice({
        text: copied
          ? "Copied the transcript path"
          : "Sent the transcript path to the terminal clipboard",
      }),
    );
  };

  useInput((rawInput, key) => {
    // Ctrl+C arrives as "c" with ctrl set; it belongs to the interrupt handler, not to copy.
    // Alt chords are ignored too, but two quick ESC presses can arrive as one meta+ESC.
    if (overlayOpen || key.ctrl || (key.meta && !key.escape)) return;
    if (showHelp) {
      setShowHelp(false);
      return;
    }
    const input = latinKey(rawInput);

    if (input === "?") {
      setShowHelp(true);
      return;
    }
    if (input === "c") {
      copyPath();
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
      const pendingLanguages = heardLanguages([props.pendingTokens]);
      const heard =
        props.getHeardLanguages !== undefined
          ? [...new Set([...props.getHeardLanguages(), ...pendingLanguages])]
          : heardLanguages([props.finalTokens, props.pendingTokens]);
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
  const focusEmpty =
    focus.length > 0 &&
    utterances.length === 0 &&
    (props.finalTokens.length > 0 || props.pendingTokens.length > 0) &&
    !props.ended;

  // Narrow terminals drop the least important hints; how to end and get help always stay.
  let hintList: KeyHint[];
  if (props.finishing) {
    hintList = [{ text: "Saving transcript  ESC force quit", priority: 1 }];
  } else if (props.ended) {
    hintList = [
      { text: "c copy path", priority: 2 },
      { text: "ESC quit", priority: 3 },
    ];
  } else if (confirmingEnd) {
    hintList = [{ text: "Press ESC again to end the session", priority: 1 }];
  } else {
    hintList = [
      { text: `p ${props.state === "paused" ? "resume" : "pause"}`, priority: 8 },
      { text: "1-9 speaker", priority: 3 },
      ...(multilingual ? [{ text: "l language", priority: 4 }] : []),
      { text: "0 all", priority: 2 },
      { text: "c copy path", priority: 1 },
      { text: "m mic", priority: 6 },
      { text: "s settings", priority: 7 },
      { text: "? keys", priority: 9 },
      { text: "ESC end", priority: 10 },
    ];
  }
  const hints = fitHints({ hints: hintList, width: columns });

  let overlay: ReactNode = null;
  if (props.overlay.kind === "mic") {
    overlay = (
      <MicrophoneSelect
        rows={overlayRows}
        microphones={props.overlay.microphones}
        current={props.device}
        loading={props.overlay.loading}
        error={props.overlay.error}
        onPick={props.onPickMicrophone}
        onCancel={props.onCloseOverlay}
      />
    );
  } else if (props.overlay.kind === "settings") {
    overlay = (
      <SettingsScreen
        {...props.overlay}
        rows={overlayRows}
        exitLabel="ESC back"
        onPickMicrophone={props.onSettingsPickMicrophone}
        onPickLanguages={props.onSettingsPickLanguages}
        onPickTranslation={props.onSettingsPickTranslation}
        onPickRegion={props.onSettingsPickRegion}
        onChangeApiKey={props.onSettingsChangeApiKey}
        onDeleteApiKey={props.onSettingsDeleteApiKey}
        onExit={props.onCloseOverlay}
      />
    );
  } else if (showHelp) {
    overlay = <HelpPanel rows={overlayRows} />;
  }

  const spoken = props.languages.join("/");
  const session =
    props.translation.length === 1
      ? `${spoken} to ${props.translation[0]}`
      : props.translation.length === 2
        ? `${spoken}, ${props.translation.join("/")} both ways`
        : spoken;

  return (
    <>
      <Static items={props.committed}>
        {(item) => {
          const itemRows = wrapUtterances({
            utterances: [
              {
                speaker: item.speaker,
                language: item.language,
                translation: item.translation,
                stable: item.text,
                pending: "",
              },
            ],
            width: columns,
            maxLines: Infinity,
            showLanguage: multilingual,
          });
          return (
            <Box key={item.id} flexDirection="column">
              {itemRows.map((line, index) => (
                <CaptionRow key={index} line={line} />
              ))}
            </Box>
          );
        }}
      </Static>

      <Box flexDirection="column">
        {maxLiveRows > 0 &&
          (focusEmpty ? (
            <Text dimColor>{`Waiting for ${focus.join(", ")} (press 0 to show all)`}</Text>
          ) : (
            captionLines.map((line, index) => <CaptionRow key={index} line={line} />)
          ))}

        {/* Overlays sit under the live caption lines and above the status line. */}
        {overlay !== null && (
          <Box
            flexDirection="column"
            flexShrink={0}
            maxHeight={maxOverlayBoxRows}
            overflow="hidden"
            borderStyle="single"
            borderDimColor
            borderLeft={false}
            borderRight={false}
            borderBottom={false}
          >
            {overlay}
          </Box>
        )}

        {props.warning !== undefined && (
          <Box width="100%" height={1} flexShrink={0} overflow="hidden">
            <Text color="red" wrap="truncate-end">
              {props.warning}
            </Text>
          </Box>
        )}
        {showPath && (
          <Box width="100%" height={1} flexShrink={0} overflow="hidden">
            <Text color="yellow" wrap="truncate-middle">
              {`Transcript: ${shortPath(props.journalPath!)}  (c to copy the path)`}
            </Text>
          </Box>
        )}
        <StatusLine
          state={props.ended ? "stopped" : props.state}
          stateMessage={props.stateMessage}
          notice={copyNotice?.text ?? props.notice}
          device={props.device}
          session={session}
          elapsedSeconds={props.elapsedSeconds}
          focus={focus}
        />
        {!overlayOpen && (
          <Box width="100%" height={1} flexShrink={0} overflow="hidden">
            <Text dimColor wrap="truncate-end">
              {hints}
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
}
