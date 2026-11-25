import { pathToFileURL } from "node:url";

import { copyWithFallback, shortPath } from "#/lib/clipboard.js";
import { stripTerminalEscapes } from "#/lib/sanitize.js";

export function printSessionEnd({ path, writeError }: { path: string; writeError?: string }) {
  const copied = copyWithFallback(path);

  const rawLabel = copied ? `${shortPath(path)} (copied to clipboard)` : path;
  const label = stripTerminalEscapes(rawLabel);
  const link = `\x1b]8;;${pathToFileURL(path).href}\x07${label}\x1b]8;;\x07`;
  console.log(`Transcript: ${link}`);
  // Also covers a failure in the final write, after the live screen could show it.
  if (writeError !== undefined) {
    console.error(`The transcript may be incomplete: ${stripTerminalEscapes(writeError)}`);
  }
}
