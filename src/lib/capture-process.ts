import { spawn, type ChildProcess } from "node:child_process";

import { resolveCaptureBin } from "#/lib/capture-bin.js";

const PASSTHROUGH_KEYS = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USER",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  // Linux / PipeWire / Pulse / ALSA device discovery
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "PULSE_SERVER",
  "PULSE_RUNTIME_PATH",
  "PIPEWIRE_RUNTIME_DIR",
  "ALSA_CARD",
  "ALSA_DEVICE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

export function spawnCapture(args: string[]) {
  const bin = resolveCaptureBin();
  if (!bin.ok) throw new Error(bin.message);

  // Minimal env for the capture sidecar (no API keys or cloud credentials).
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return spawn(bin.path, args, { stdio: ["ignore", "pipe", "pipe"], env });
}

export function spawnFailureMessage({
  child,
  error,
}: {
  child: ChildProcess;
  error: NodeJS.ErrnoException;
}) {
  return `Failed to run capture helper: ${error.code === "ENOENT" ? child.spawnfile : error.message}`;
}

export function killCapture({ child, force }: { child: ChildProcess; force: boolean }) {
  // Windows: signal names are not POSIX; bare kill() is the reliable force path.
  if (process.platform === "win32") child.kill();
  else child.kill(force ? "SIGKILL" : "SIGTERM");
}

export function stopCaptureChild({
  child,
  markStopped,
  graceMs,
}: {
  child: ChildProcess;
  markStopped: () => void;
  graceMs: number;
}) {
  return new Promise<void>((resolve) => {
    markStopped();
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const killTimer = setTimeout(() => killCapture({ child, force: true }), graceMs);
    child.once("close", () => {
      clearTimeout(killTimer);
      resolve();
    });
    killCapture({ child, force: false });
  });
}
