import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultLanguageHints,
  languageGeneralContext,
  languageSelectOptions,
  localeLanguage,
  normalizeLanguageHints,
  normalizeTranslation,
  parseLanguageList,
  translationLabel,
} from "#/lib/languages.js";

function instructions(hints: Parameters<typeof languageGeneralContext>[0]) {
  return languageGeneralContext(hints).find((entry) => entry.key === "instructions")!.value;
}

describe("locale defaults", () => {
  it("maps system locales to Soniox codes", () => {
    assert.equal(localeLanguage("ja-JP"), "ja");
    assert.equal(localeLanguage("nb-NO"), "no");
    assert.equal(localeLanguage("fil-PH"), "tl");
    assert.equal(localeLanguage("zz"), undefined);
    assert.equal(localeLanguage("not a locale"), undefined);
  });

  it("pairs a non-English system language with English", () => {
    assert.deepEqual(defaultLanguageHints("en-GB"), ["en"]);
    assert.deepEqual(defaultLanguageHints("de-DE"), ["de", "en"]);
    assert.deepEqual(defaultLanguageHints("zz"), ["en"]);
  });
});

describe("normalizeLanguageHints", () => {
  it("drops unknown and duplicate codes", () => {
    assert.deepEqual(normalizeLanguageHints(["ja", "xx", "ja", 3, "en"]), ["ja", "en"]);
  });
});

describe("parseLanguageList", () => {
  it("accepts comma-separated codes in any case", () => {
    assert.deepEqual(parseLanguageList({ raw: " JA, en ,", flag: "--lang" }), ["ja", "en"]);
  });

  it("rejects unknown or empty input", () => {
    assert.throws(
      () => parseLanguageList({ raw: "ja,xx", flag: "--lang" }),
      /Unknown language code: xx/,
    );
    assert.throws(
      () => parseLanguageList({ raw: "", flag: "--translate" }),
      /such as --translate en/,
    );
  });
});

describe("languageSelectOptions", () => {
  it("puts selected, system, English, and Korean first", () => {
    const values = languageSelectOptions({ selected: ["th", "ja"], locale: "de-DE" })
      .slice(0, 6)
      .map((option) => option.value);
    assert.deepEqual(values, ["th", "ja", "de", "en", "ko", "af"]);
  });

  it("lists every language once", () => {
    const values = languageSelectOptions({ selected: ["en"], locale: "en-US" }).map(
      (option) => option.value,
    );
    assert.equal(new Set(values).size, values.length);
    assert.equal(values.length, 60);
  });
});

describe("languageGeneralContext", () => {
  it("keeps the Korean wording", () => {
    assert.equal(
      instructions(["ko"]),
      "Speech is primarily Korean. Prefer Hangul. Keep English proper nouns, product names, and loanwords in Latin script.",
    );
    assert.equal(
      instructions(["ko", "en"]),
      "Speech may mix Korean, English. Prefer Hangul for Korean. Keep other languages in their native scripts.",
    );
  });

  it("names the script for other non-Latin languages", () => {
    assert.match(instructions(["ja"]), /Prefer kanji and kana\./);
    assert.match(
      instructions(["ru", "uk", "en"]),
      /Prefer Cyrillic for Russian, Cyrillic for Ukrainian\./,
    );
  });

  it("restricts a single Latin-script language", () => {
    assert.equal(
      instructions(["de"]),
      "Conversation is in German. Output transcription only in German.",
    );
    assert.match(instructions(["de", "fr"]), /each language in its native script/);
  });
});

describe("translation settings", () => {
  it("accepts one or two languages and turns off otherwise", () => {
    assert.deepEqual(normalizeTranslation(["ko"]), ["ko"]);
    assert.deepEqual(normalizeTranslation(["en", "es", "en"]), ["en", "es"]);
    assert.deepEqual(normalizeTranslation(["en", "es", "ko"]), []);
    assert.deepEqual(normalizeTranslation(["xx"]), []);
    assert.deepEqual(normalizeTranslation(undefined), []);
  });

  it("describes the mode", () => {
    assert.equal(translationLabel([]), "Off");
    assert.equal(translationLabel(["ko"]), "Into Korean (ko)");
    assert.equal(translationLabel(["en", "es"]), "Between English (en) and Spanish (es)");
  });
});
