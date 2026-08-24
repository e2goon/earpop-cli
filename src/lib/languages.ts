/** Soniox STT ISO codes: https://soniox.com/docs/stt/concepts/supported-languages */
const STT_LANGUAGES = [
  { code: "af", name: "Afrikaans" },
  { code: "sq", name: "Albanian" },
  { code: "ar", name: "Arabic" },
  { code: "az", name: "Azerbaijani" },
  { code: "eu", name: "Basque" },
  { code: "be", name: "Belarusian" },
  { code: "bn", name: "Bengali" },
  { code: "bs", name: "Bosnian" },
  { code: "bg", name: "Bulgarian" },
  { code: "ca", name: "Catalan" },
  { code: "zh", name: "Chinese" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "et", name: "Estonian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "gl", name: "Galician" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "gu", name: "Gujarati" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "kn", name: "Kannada" },
  { code: "kk", name: "Kazakh" },
  { code: "ko", name: "Korean" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "mk", name: "Macedonian" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sr", name: "Serbian" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Tagalog" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" },
  { code: "cy", name: "Welsh" },
] as const;

export type SttLanguage = (typeof STT_LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE_HINTS: readonly SttLanguage[] = ["en"];

const BY_CODE = new Map<string, (typeof STT_LANGUAGES)[number]>(
  STT_LANGUAGES.map((language) => [language.code, language]),
);

function isSttLanguage(value: string): value is SttLanguage {
  return BY_CODE.has(value);
}

function languageName(code: SttLanguage) {
  return BY_CODE.get(code)?.name ?? code;
}

export function normalizeLanguageHints(raw: unknown) {
  if (!Array.isArray(raw)) return [...DEFAULT_LANGUAGE_HINTS];
  const seen = new Set<SttLanguage>();
  const hints: SttLanguage[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isSttLanguage(item) || seen.has(item)) continue;
    seen.add(item);
    hints.push(item);
  }
  return hints.length > 0 ? hints : [...DEFAULT_LANGUAGE_HINTS];
}

export function languageHintLabel(codes: SttLanguage[]) {
  return codes.map((code) => `${languageName(code)} (${code})`).join(", ");
}

// Pin English/Korean first; the rest follow Soniox's alphabetical list.
export const LANGUAGE_SELECT_OPTIONS = [
  ...STT_LANGUAGES.filter((language) => language.code === "en" || language.code === "ko"),
  ...STT_LANGUAGES.filter((language) => language.code !== "en" && language.code !== "ko"),
].map((language) => ({
  label: `${language.name} (${language.code})`,
  value: language.code,
}));

export function languageGeneralContext(hints: SttLanguage[]) {
  const listed = hints.map(languageName).join(", ");
  const koreanOnly = hints.length === 1 && hints[0] === "ko";
  const mixedWithKorean = hints.length > 1 && hints.includes("ko");
  let instructions: string;
  if (koreanOnly) {
    instructions =
      "Speech is primarily Korean. Prefer Hangul. Keep English proper nouns, product names, and loanwords in Latin script.";
  } else if (hints.length === 1) {
    instructions = `Conversation is in ${listed}. Output transcription only in ${listed}.`;
  } else if (mixedWithKorean) {
    instructions = `Speech may mix ${listed}. Prefer Hangul for Korean. Keep other languages in their native scripts.`;
  } else {
    instructions = `Speech may mix ${listed}. Transcribe each language in its native script.`;
  }
  return [
    { key: "language", value: listed },
    { key: "instructions", value: instructions },
    { key: "setting", value: "Casual live conversation transcription" },
  ];
}
