import type { ChildProcess } from "node:child_process";

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

/** Minimal env for the capture sidecar (no API keys or cloud credentials). */
export function captureSpawnEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
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
    const killTimer = setTimeout(() => {
      // Windows: signal names are not POSIX; bare kill() is the reliable force path.
      if (process.platform === "win32") child.kill();
      else child.kill("SIGKILL");
    }, graceMs);
    child.once("close", () => {
      clearTimeout(killTimer);
      resolve();
    });
    if (process.platform === "win32") child.kill();
    else child.kill("SIGTERM");
  });
}
