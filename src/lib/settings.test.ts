import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fitTerms,
  loadSettings,
  MAX_TERMS_CHARS,
  normalizeTerms,
  saveSettings,
} from "#/lib/settings.js";
import { useTempHome } from "#/test-utils/temp-home.js";

describe("normalizeTerms", () => {
  it("trims, collapses spaces, and drops blanks and repeats", () => {
    assert.deepEqual(normalizeTerms([" Soniox  Console ", "", "웬민", "Soniox Console", 3]), [
      "Soniox Console",
      "웬민",
    ]);
    assert.deepEqual(normalizeTerms("nope"), []);
  });
});

describe("terms in settings", () => {
  useTempHome();

  it("round-trips and removes the key when emptied", async () => {
    await saveSettings({ languages: ["ja"], terms: ["東京", " earpop "] });
    assert.deepEqual(await loadSettings(), { languages: ["ja"], terms: ["東京", "earpop"] });
    await saveSettings({ terms: [] });
    assert.deepEqual(await loadSettings(), { languages: ["ja"] });
  });

  it("keeps hand-edited terms past the limit in the file", async () => {
    const long = "x".repeat(MAX_TERMS_CHARS - 10);
    await saveSettings({ terms: [long, "fits", "does not fit"] });
    await saveSettings({ microphone: "Other mic" });
    const terms = (await loadSettings()).terms!;
    assert.equal(terms.length, 3);
    assert.deepEqual(fitTerms(terms), [long, "fits"]);
  });
});
