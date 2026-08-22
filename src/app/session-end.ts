import { copyToClipboard, osc52Sequence, shortPath } from "#/lib/clipboard.js";

export function printSessionEnd(path: string) {
  const copied = copyToClipboard(path);
  if (!copied) process.stdout.write(osc52Sequence(path));

  const label = copied ? `${shortPath(path)} (copied to clipboard)` : path;
  const link = `\x1b]8;;file://${path}\x07${label}\x1b]8;;\x07`;
  console.log(`Transcript: ${link}`);
}
