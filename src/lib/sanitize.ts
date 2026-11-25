// Strips ANSI/OSC/DCS/CSI escape sequences and C0/C1 control characters from untrusted text.
// Uses explicit Unicode escapes + \p{Cc} so emoji joiners (\p{Cf}) stay intact.
const ESCAPE_SEQUENCE = new RegExp(
  [
    "\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)",
    "\\u009d[^\\u0007\\u001b\\u009c]*(?:\\u0007|\\u001b\\\\|\\u009c)",
    "\\u001b[PX^_][^\\u001b]*\\u001b\\\\",
    "(?:\\u001b\\[|\\u009b)[0-?]*[ -/]*[@-~]",
    "\\u001b[@-Z\\\\-_]",
  ].join("|"),
  "g",
);

export function stripTerminalEscapes(text: string) {
  return text.replace(ESCAPE_SEQUENCE, "").replace(/\p{Cc}+/gu, "");
}
