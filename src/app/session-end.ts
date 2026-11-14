import { copyWithFallback, shortPath } from "#/lib/clipboard.js";

export function printSessionEnd({ path, writeError }: { path: string; writeError?: string }) {
  const copied = copyWithFallback(path);

  const label = copied ? `${shortPath(path)} (copied to clipboard)` : path;
  const link = `\x1b]8;;file://${path}\x07${label}\x1b]8;;\x07`;
  console.log(`Transcript: ${link}`);
  // Also covers a failure in the final write, after the live screen could show it.
  if (writeError !== undefined) console.error(`The transcript may be incomplete: ${writeError}`);
}
