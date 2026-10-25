import { copyWithFallback, shortPath } from "#/lib/clipboard.js";

export function printSessionEnd(path: string) {
  const copied = copyWithFallback(path);

  const label = copied ? `${shortPath(path)} (copied to clipboard)` : path;
  const link = `\x1b]8;;file://${path}\x07${label}\x1b]8;;\x07`;
  console.log(`Transcript: ${link}`);
}
