import {
  loadSettings,
  MAX_TERMS_CHARS,
  normalizeTerms,
  saveSettings,
  termsSize,
} from "#/lib/settings.js";

const USAGE = `Usage: earpop terms                    List saved terms
       earpop terms add <term>...     Add words or names to spell as listed
       earpop terms remove <term>...  Remove terms
       earpop terms clear             Remove every term`;

export async function runTermsCommand(args: string[]) {
  const [sub, ...values] = args;
  const current = (await loadSettings()).terms ?? [];

  if (sub === undefined || sub === "list") {
    if (current.length === 0) {
      console.log("No saved terms. Add some with: earpop terms add <term>...");
      return;
    }
    console.log(current.join("\n"));
    return;
  }

  if (sub === "add" && values.length > 0) {
    const next = normalizeTerms([...current, ...values]);
    const size = termsSize(next);
    if (size > MAX_TERMS_CHARS) {
      throw new Error(
        `Terms would total ${size} characters; the limit is ${MAX_TERMS_CHARS}. Remove terms people rarely say.`,
      );
    }
    await saveSettings({ terms: next });
    console.log(`Saved ${next.length - current.length} new term(s), ${next.length} in total.`);
    return;
  }

  if (sub === "remove" && values.length > 0) {
    const drop = new Set(normalizeTerms(values));
    const next = current.filter((term) => !drop.has(term));
    await saveSettings({ terms: next });
    console.log(`Removed ${current.length - next.length} term(s), ${next.length} left.`);
    return;
  }

  if (sub === "clear") {
    await saveSettings({ terms: [] });
    console.log("Removed every term.");
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}
