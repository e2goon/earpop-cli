import { spawn, type ChildProcess } from "node:child_process";

import { resolveCaptureBin } from "#/lib/capture-bin.js";
import type { AudioCapture, AudioOptions } from "#/lib/types";

// 100ms × 16kHz × 2 bytes (s16le) — same as desktop / earpop-capture.
const FRAME_BYTES = 3200;

const FIRST_FRAME_TIMEOUT_MS = 10_000;
const TERM_GRACE_MS = 2_000;

function micPermissionHint() {
  if (process.platform === "darwin") {
    return "allow this terminal app under System Settings > Privacy & Security > Microphone";
  }
  if (process.platform === "win32") {
    return "allow microphone access in Windows Settings > Privacy & security > Microphone";
  }
  if (process.platform === "linux") {
    return "check microphone permissions and that ALSA/PipeWire can open the device";
  }
  return "check microphone permissions";
}

function captureErrorMessage({ code, stderr }: { code: number | null; stderr: string }) {
  const detail = stderr.trim().split("\n").slice(-3).join(" ") || `exit code ${code ?? "unknown"}`;
  return `Cannot use microphone: ${detail} — ${micPermissionHint()}`;
}

function stopProcess({ child, markStopped }: { child: ChildProcess; markStopped: () => void }) {
  return new Promise<void>((resolve) => {
    markStopped();
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const killTimer = setTimeout(() => child.kill("SIGKILL"), TERM_GRACE_MS);
    child.once("close", () => {
      clearTimeout(killTimer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export function startCapture({ device: deviceOption, onFrame, onError }: AudioOptions) {
  const device = deviceOption ?? "default";
  return new Promise<AudioCapture>((resolve, reject) => {
    const bin = resolveCaptureBin();
    if (!bin.ok) {
      reject(new Error(bin.message));
      return;
    }

    const args = ["capture"];
    if (device !== "default") {
      args.push("--device", device);
    }

    const child = spawn(bin.path, args, { stdio: ["ignore", "pipe", "pipe"] });

    let settled = false;
    let stopped = false;
    let stderr = "";
    let remainder = Buffer.alloc(0);

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(firstFrameTimer);
      reject(new Error(message));
    };

    const firstFrameTimer = setTimeout(
      () =>
        fail(
          `No microphone response for ${FIRST_FRAME_TIMEOUT_MS / 1000}s. Check microphone permission and device connection`,
        ),
      FIRST_FRAME_TIMEOUT_MS,
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      fail(
        error.code === "ENOENT"
          ? `Failed to run capture helper: ${bin.path}`
          : `Failed to run capture helper: ${error.message}`,
      );
    });

    child.on("close", (code) => {
      if (!settled) {
        fail(captureErrorMessage({ code, stderr }));
        return;
      }
      if (!stopped) onError(captureErrorMessage({ code, stderr }));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const data = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
      let offset = 0;
      while (data.length - offset >= FRAME_BYTES) {
        onFrame(Buffer.from(data.subarray(offset, offset + FRAME_BYTES)));
        offset += FRAME_BYTES;
      }
      remainder = Buffer.from(data.subarray(offset));

      if (!settled) {
        settled = true;
        clearTimeout(firstFrameTimer);
        resolve({
          device,
          stop: () =>
            stopProcess({
              child,
              markStopped: () => {
                stopped = true;
              },
            }),
        });
      }
    });
  });
}
