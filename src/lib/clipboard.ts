import { spawn, spawnSync } from "node:child_process";
import { basename } from "node:path";

const COPY_TIMEOUT_MS = 1_000;

const CANDIDATES: Array<{ command: string; args: string[] }> = [
  { command: "pbcopy", args: [] },
  { command: "wl-copy", args: [] },
  { command: "xclip", args: ["-selection", "clipboard"] },
  { command: "xsel", args: ["--clipboard", "--input"] },
];

export function shortPath(path: string) {
  return basename(path);
}

function copyWithOsc52(text: string) {
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
}

/** Sync, for the last moment before exit: an async copy would die with process.exit(0). */
export function copyWithFallback(text: string) {
  for (const candidate of CANDIDATES) {
    try {
      const result = spawnSync(candidate.command, candidate.args, {
        input: text,
        timeout: COPY_TIMEOUT_MS,
        stdio: ["pipe", "ignore", "ignore"],
      });
      if (result.error === undefined && result.status === 0) return true;
    } catch {}
  }
  copyWithOsc52(text);
  return false;
}

function tryCopy({ command, args, text }: { command: string; args: string[]; text: string }) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill(), COPY_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}

/** Async, for use during a session: a stuck clipboard tool must not stall audio or captions. */
export async function copyInBackground(text: string) {
  for (const candidate of CANDIDATES) {
    if (await tryCopy({ ...candidate, text })) return true;
  }
  copyWithOsc52(text);
  return false;
}
