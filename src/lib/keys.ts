import stringWidth from "string-width";

// Dubeolsik (standard Korean) jamo on each QWERTY key, so shortcuts still work when the input
// method is left in Hangul mode.
const HANGUL_KEYS: Record<string, string> = {
  ㅂ: "q",
  ㅈ: "w",
  ㄷ: "e",
  ㄱ: "r",
  ㅅ: "t",
  ㅛ: "y",
  ㅕ: "u",
  ㅑ: "i",
  ㅐ: "o",
  ㅔ: "p",
  ㅁ: "a",
  ㄴ: "s",
  ㅇ: "d",
  ㄹ: "f",
  ㅎ: "g",
  ㅗ: "h",
  ㅓ: "j",
  ㅏ: "k",
  ㅣ: "l",
  ㅋ: "z",
  ㅌ: "x",
  ㅊ: "c",
  ㅍ: "v",
  ㅠ: "b",
  ㅜ: "n",
  ㅡ: "m",
  ㅃ: "Q",
  ㅉ: "W",
  ㄸ: "E",
  ㄲ: "R",
  ㅆ: "T",
  ㅒ: "O",
  ㅖ: "P",
};

/** The QWERTY key behind a Hangul jamo; other input passes through unchanged. */
export function latinKey(input: string) {
  return HANGUL_KEYS[input] ?? input;
}

export interface KeyHint {
  text: string;
  /** Higher stays longer when the line is too narrow. */
  priority: number;
}

const HINT_GAP = "  ";

/** Drops the lowest-priority hints until the rest fit, keeping their order. */
export function fitHints({ hints, width }: { hints: KeyHint[]; width: number }) {
  const kept = [...hints];
  const lineWidth = () => stringWidth(kept.map((hint) => hint.text).join(HINT_GAP));
  while (kept.length > 1 && lineWidth() > width) {
    let lowest = 0;
    kept.forEach((hint, index) => {
      if (hint.priority < kept[lowest]!.priority) lowest = index;
    });
    kept.splice(lowest, 1);
  }
  return kept.map((hint) => hint.text).join(HINT_GAP);
}
