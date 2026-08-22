import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AudioCapture, AudioOptions } from "#/lib/types";

// 100ms × 16kHz × 2 bytes (s16le) — Soniox frame size.
const FRAME_BYTES = 3200;

const FIRST_FRAME_TIMEOUT_MS = 10_000;
const TERM_GRACE_MS = 2_000;

export const FFMPEG_MISSING =
  "ffmpeg is not installed. Run `brew install ffmpeg` in your terminal, then try again.";

function captureErrorMessage({ code, stderr }: { code: number | null; stderr: string }) {
  const detail = stderr.trim().split("\n").slice(-3).join(" ") || `exit code ${code ?? "unknown"}`;
  return `Cannot use microphone: ${detail} — allow this terminal app under System Settings > Privacy & Security > Microphone`;
}

function stopProcess({
  child,
  markStopped,
}: {
  child: ChildProcessWithoutNullStreams;
  markStopped: () => void;
}) {
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
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "avfoundation",
      "-i",
      `:${device}`,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "s16le",
      "-",
    ]);

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
      fail(error.code === "ENOENT" ? FFMPEG_MISSING : `Failed to run ffmpeg: ${error.message}`);
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
