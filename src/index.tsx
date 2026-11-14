import { parseArgs } from "node:util";

import { runTermsCommand } from "#/app/terms-command.js";
import { runTranscriptsCommand } from "#/app/transcripts-command.js";
import { deleteApiKey } from "#/lib/api-key.js";
import { errorMessage } from "#/lib/errors.js";
import { listLanguages, parseLanguageList } from "#/lib/languages.js";
import { resolveRegion } from "#/lib/region.js";
import { loadSettings } from "#/lib/settings.js";
import { version } from "../package.json";

const HELP = [
  "earpop: live transcription",
  "",
  "Usage:",
  "  earpop [--lang <codes>]      Start live transcription (s opens settings)",
  "                               --lang ja,en sets languages for this run only",
  "                               --translate ko translates into Korean;",
  "                               --translate en,es translates between two",
  "  earpop settings              Settings (microphone, languages, API key)",
  "  earpop transcripts list      List transcripts",
  "  earpop transcripts view <id>   Print a transcript (id or latest)",
  "  earpop transcripts export <id> Save a transcript next to its JSONL file",
  "                               --format txt|srt|vtt|md, --out <path>",
  "  earpop languages             List supported language codes",
  "  earpop terms [add|remove]    Words and names to spell as listed",
  "  earpop auth clear            Delete the saved API key",
  "  earpop --version             Print the version",
].join("\n");

function main() {
  const [first, ...rest] = process.argv.slice(2);

  // Live mode is the bare command, so its options come first; subcommands parse their own.
  if (first === undefined || (first.startsWith("-") && first !== "-h" && first !== "--help")) {
    let parsed;
    try {
      parsed = parseArgs({
        args: process.argv.slice(2),
        options: {
          lang: { type: "string" },
          translate: { type: "string" },
          version: { type: "boolean", short: "v" },
        },
      }).values;
    } catch (error) {
      console.error(`${errorMessage(error)}\n\n${HELP}`);
      process.exitCode = 1;
      return;
    }
    if (parsed.version === true) {
      console.log(version);
      return;
    }
    let languages;
    let translation;
    try {
      languages =
        parsed.lang !== undefined
          ? parseLanguageList({ raw: parsed.lang, flag: "--lang" })
          : undefined;
      translation =
        parsed.translate !== undefined
          ? parseLanguageList({ raw: parsed.translate, flag: "--translate" })
          : undefined;
      if (translation !== undefined && translation.length > 2) {
        throw new Error("--translate takes one language (one-way) or two (two-way)");
      }
    } catch (error) {
      console.error(errorMessage(error));
      process.exitCode = 1;
      return;
    }
    void import("#/app/tui.js").then(({ runTui }) =>
      runTui({ screen: "live", languages, translation }),
    );
    return;
  }

  const command = first;

  if (command === "languages") {
    console.log(listLanguages());
    return;
  }

  if (command === "settings") {
    void import("#/app/tui.js").then(({ runTui }) => runTui({ screen: "settings" }));
    return;
  }

  if (command === "transcripts") {
    void runTranscriptsCommand(rest).catch((error: unknown) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
    return;
  }

  if (command === "terms") {
    void runTermsCommand(rest).catch((error: unknown) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
    return;
  }

  if (command === "auth" && rest[0] === "clear") {
    void loadSettings()
      .then((settings) => deleteApiKey(resolveRegion(settings)))
      .then(() => {
        console.log("Deleted the API key saved for the current region.");
      })
      .catch((error: unknown) => {
        console.error(`Failed to delete API key: ${errorMessage(error)}`);
        process.exitCode = 1;
      });
    return;
  }

  console.log(HELP);
  if (command !== "--help" && command !== "-h" && command !== "help") {
    process.exitCode = 1;
  }
}

main();
