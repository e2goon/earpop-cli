import { spawnSync } from "node:child_process";

// Sync spawn: async would be killed by process.exit(0) before the copy finishes.
const CANDIDATES: Array<{ command: string; args: string[] }> = [
  { command: "pbcopy", args: [] },
  { command: "wl-copy", args: [] },
  { command: "xclip", args: ["-selection", "clipboard"] },
  { command: "xsel", args: ["--clipboard", "--input"] },
];

export function shortPath(path: string) {
  const base = path.split("/").pop() ?? path;
  return `[…/${base}]`;
}

export function copyToClipboard(text: string) {
  for (const candidate of CANDIDATES) {
    try {
      const result = spawnSync(candidate.command, candidate.args, {
        input: text,
        timeout: 1_000,
        stdio: ["pipe", "ignore", "ignore"],
      });
      if (result.error === undefined && result.status === 0) return true;
    } catch {}
  }
  return false;
}

export function osc52Sequence(text: string) {
  return `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
}
