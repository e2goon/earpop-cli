import { NO_SPACE_SCRIPT } from "#/lib/languages.js";

// Boundary rules shared by live captions and transcript exports.

// Marks that end a sentence on their own, across scripts (Latin, CJK, Devanagari, Arabic, Urdu).
const SENTENCE_END = /[?!。？！।॥؟۔]$/u;
// A sentence mark may sit inside closing quotes or brackets: `?"`, `。」`.
const CLOSING_MARKS = /[\s"'”’»)\]}」』》）】]+$/u;

/** Silence that starts a new line or paragraph; also covers scripts without sentence marks (Thai). */
export const PAUSE_BREAK_MS = 2_000;

export function sentenceMark(text: string) {
  const bare = text.replace(CLOSING_MARKS, "");
  if (SENTENCE_END.test(bare)) return "end";
  // "1.5" and "Dr. Smith" both arrive as "." then a token; only the next token can tell them apart.
  if (bare.endsWith(".")) return "period";
  return null;
}

// Soniox puts word spacing on the leading edge of the next token.
export function startsNewWord(text: string) {
  return /^\s/.test(text) || NO_SPACE_SCRIPT.test(text.charAt(0));
}
