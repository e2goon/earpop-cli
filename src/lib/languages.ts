/**
 * Soniox STT ISO codes: https://soniox.com/docs/stt/concepts/supported-languages
 * `script` is set for languages not written in Latin script; it steers the recognition context.
 */
const STT_LANGUAGES = [
  { code: "af", name: "Afrikaans" },
  { code: "sq", name: "Albanian" },
  { code: "ar", name: "Arabic", script: "Arabic script" },
  { code: "az", name: "Azerbaijani" },
  { code: "eu", name: "Basque" },
  { code: "be", name: "Belarusian", script: "Cyrillic" },
  { code: "bn", name: "Bengali", script: "Bengali script" },
  { code: "bs", name: "Bosnian" },
  { code: "bg", name: "Bulgarian", script: "Cyrillic" },
  { code: "ca", name: "Catalan" },
  { code: "zh", name: "Chinese", script: "Chinese characters" },
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
  { code: "el", name: "Greek", script: "Greek script" },
  { code: "gu", name: "Gujarati", script: "Gujarati script" },
  { code: "he", name: "Hebrew", script: "Hebrew script" },
  { code: "hi", name: "Hindi", script: "Devanagari" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese", script: "kanji and kana" },
  { code: "kn", name: "Kannada", script: "Kannada script" },
  { code: "kk", name: "Kazakh", script: "Cyrillic" },
  { code: "ko", name: "Korean", script: "Hangul" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "mk", name: "Macedonian", script: "Cyrillic" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam", script: "Malayalam script" },
  { code: "mr", name: "Marathi", script: "Devanagari" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian", script: "Persian script" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi", script: "Gurmukhi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian", script: "Cyrillic" },
  { code: "sr", name: "Serbian", script: "Cyrillic" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Tagalog" },
  { code: "ta", name: "Tamil", script: "Tamil script" },
  { code: "te", name: "Telugu", script: "Telugu script" },
  { code: "th", name: "Thai", script: "Thai script" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian", script: "Cyrillic" },
  { code: "ur", name: "Urdu", script: "Urdu script" },
  { code: "vi", name: "Vietnamese" },
  { code: "cy", name: "Welsh" },
] as const;

export type SttLanguage = (typeof STT_LANGUAGES)[number]["code"];

// Scripts written without spaces between words.
export const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

type LanguageEntry = { code: SttLanguage; name: string; script?: string };

const BY_CODE = new Map<string, LanguageEntry>(
  STT_LANGUAGES.map((language) => [language.code, language]),
);

// System locale subtags that Soniox lists under another code.
const LOCALE_ALIASES: Record<string, SttLanguage> = { nb: "no", nn: "no", fil: "tl", iw: "he" };

export function isSttLanguage(value: string): value is SttLanguage {
  return BY_CODE.has(value);
}

function languageName(code: SttLanguage) {
  return BY_CODE.get(code)?.name ?? code;
}

export function localeLanguage(locale = new Intl.DateTimeFormat().resolvedOptions().locale) {
  let language: string;
  try {
    language = new Intl.Locale(locale).language;
  } catch {
    return undefined;
  }
  const code = LOCALE_ALIASES[language] ?? language;
  return isSttLanguage(code) ? code : undefined;
}

// First run: the system language plus English, since meetings often mix in English terms.
export function defaultLanguageHints(locale?: string): SttLanguage[] {
  const local = localeLanguage(locale);
  return local === undefined || local === "en" ? ["en"] : [local, "en"];
}

export function normalizeLanguageHints(raw: unknown) {
  if (!Array.isArray(raw)) return defaultLanguageHints();
  const seen = new Set<SttLanguage>();
  const hints: SttLanguage[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isSttLanguage(item) || seen.has(item)) continue;
    seen.add(item);
    hints.push(item);
  }
  return hints.length > 0 ? hints : defaultLanguageHints();
}

/** Translation targets: one language (one-way) or two (two-way); anything else turns it off. */
export function normalizeTranslation(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const codes = [...new Set(raw)].filter(
    (code): code is SttLanguage => typeof code === "string" && isSttLanguage(code),
  );
  return codes.length <= 2 ? codes : [];
}

export function translationLabel(codes: SttLanguage[]) {
  if (codes.length === 0) return "Off";
  if (codes.length === 1) return `Into ${languageHintLabel(codes)}`;
  return `Between ${codes.map((code) => languageHintLabel([code])).join(" and ")}`;
}

export function languageHintLabel(codes: SttLanguage[]) {
  return codes.map((code) => `${languageName(code)} (${code})`).join(", ");
}

/** Parses a comma-separated code list such as `ja,en`; throws on unknown codes. */
export function parseLanguageList({ raw, flag }: { raw: string; flag: string }) {
  const codes = raw
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code !== "");
  const unknown = codes.filter((code) => !isSttLanguage(code));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown language code: ${unknown.join(", ")}. Run 'earpop languages' to list supported codes.`,
    );
  }
  if (codes.length === 0) throw new Error(`Specify at least one language code, such as ${flag} en`);
  return [...new Set(codes)] as SttLanguage[];
}

export function listLanguages() {
  return STT_LANGUAGES.map((language) => `${language.code}\t${language.name}`).join("\n");
}

// Selected languages first, then the system language, English, and Korean; the rest follow
// Soniox's alphabetical list.
export function languageSelectOptions({
  selected,
  locale,
}: {
  selected: SttLanguage[];
  locale?: string;
}) {
  const pinned = [...selected, localeLanguage(locale), "en", "ko"];
  const rank = (code: string) => {
    const index = pinned.indexOf(code);
    return index === -1 ? pinned.length : index;
  };
  return [...STT_LANGUAGES]
    .sort((a, b) => rank(a.code) - rank(b.code))
    .map((language) => ({ label: `${language.name} (${language.code})`, value: language.code }));
}

export function languageGeneralContext(hints: SttLanguage[]) {
  const languages = hints.map((code) => BY_CODE.get(code)!);
  const listed = languages.map((language) => language.name).join(", ");
  const scripted = languages.filter((language) => language.script !== undefined);
  let instructions: string;
  if (languages.length === 1 && scripted.length === 1) {
    instructions = `Speech is primarily ${listed}. Prefer ${scripted[0]!.script}. Keep English proper nouns, product names, and loanwords in Latin script.`;
  } else if (languages.length === 1) {
    instructions = `Conversation is in ${listed}. Output transcription only in ${listed}.`;
  } else if (scripted.length > 0) {
    const prefer = scripted.map((language) => `${language.script} for ${language.name}`).join(", ");
    instructions = `Speech may mix ${listed}. Prefer ${prefer}. Keep other languages in their native scripts.`;
  } else {
    instructions = `Speech may mix ${listed}. Transcribe each language in its native script.`;
  }
  return [
    { key: "language", value: listed },
    { key: "instructions", value: instructions },
    { key: "setting", value: "Casual live conversation transcription" },
  ];
}
