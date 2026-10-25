import { runTranscriptsCommand } from "#/app/transcripts-command.js";
import { deleteApiKey } from "#/lib/api-key.js";
import { errorMessage } from "#/lib/errors.js";
import { resolveRegion } from "#/lib/region.js";
import { loadSettings } from "#/lib/settings.js";

const HELP = [
  "earpop: live transcription",
  "",
  "Usage:",
  "  earpop                       Start live transcription (s opens settings)",
  "  earpop settings              Settings (microphone, languages, API key)",
  "  earpop transcripts list      List transcripts",
  "  earpop transcripts view <id>   Print transcript as txt to stdout",
  "  earpop transcripts export <id> Save transcript as a txt file",
  "  earpop auth clear            Delete the saved API key",
].join("\n");

function main() {
  const [, , command, ...rest] = process.argv;

  if (command === undefined || command === "settings") {
    void import("#/app/tui.js").then(({ runTui }) =>
      runTui(command === undefined ? "live" : "settings"),
    );
    return;
  }

  if (command === "transcripts") {
    void runTranscriptsCommand({ sub: rest[0], id: rest[1] }).catch((error: unknown) => {
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
