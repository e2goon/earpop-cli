import { render } from "ink";

import { installInterruptListeners } from "#/app/interrupt.js";
import { registerApp } from "#/app/runtime.js";
import { LiveApp } from "#/app/live-app.js";
import { SettingsApp } from "#/app/settings-app.js";
import { runTranscriptsCommand } from "#/app/transcripts-command.js";
import { resolveRegion } from "#/lib/region.js";
import { deleteApiKey } from "#/lib/api-key.js";

const HELP = [
  "earpop — live transcription",
  "",
  "Usage:",
  "  earpop                       Start live transcription",
  "  earpop settings              Settings (microphone, languages, API key)",
  "  earpop transcripts list      List transcripts",
  "  earpop transcripts view <id>   Print transcript as txt to stdout",
  "  earpop transcripts export <id> Save transcript as a txt file",
  "  earpop auth clear            Delete the saved API key",
].join("\n");

function printUsage() {
  console.log(HELP);
  process.exitCode = 1;
}

function main() {
  const [, , command, ...rest] = process.argv;

  if (command === undefined) {
    installInterruptListeners();
    registerApp(render(<LiveApp />, { exitOnCtrlC: false }));
    return;
  }

  if (command === "settings") {
    installInterruptListeners();
    registerApp(render(<SettingsApp />, { exitOnCtrlC: false }));
    return;
  }

  if (command === "transcripts") {
    void runTranscriptsCommand({ sub: rest[0], id: rest[1] }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
    return;
  }

  if (command === "auth" && rest[0] === "clear") {
    void resolveRegion()
      .then(deleteApiKey)
      .then(() => {
        console.log("Deleted the API key saved for the current region.");
      })
      .catch((error: unknown) => {
        console.error(
          `Failed to delete API key: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
      });
    return;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return;
  }

  printUsage();
}

main();
