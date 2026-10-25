import { spawnCapture, spawnFailureMessage, stopCaptureChild } from "#/lib/capture-process.js";
import type { AudioCapture, AudioOptions } from "#/lib/types";

// 100ms × 16kHz × 2 bytes (s16le) — same as desktop / earpop-capture.
const FRAME_BYTES = 3200;

const FIRST_FRAME_TIMEOUT_MS = 10_000;
const TERM_GRACE_MS = 2_000;
const STDERR_KEEP_CHARS = 4_096;

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

export function startCapture({ device, onFrame, onError }: AudioOptions) {
  return new Promise<AudioCapture>((resolve, reject) => {
    const args = ["capture"];
    if (device !== "default") {
      args.push("--device", device);
    }

    const child = spawnCapture(args);

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
      fail(spawnFailureMessage({ child, error }));
    });

    child.on("close", (code) => {
      if (!settled) {
        fail(captureErrorMessage({ code, stderr }));
        return;
      }
      if (!stopped) onError(captureErrorMessage({ code, stderr }));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP_CHARS);
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
            stopCaptureChild({
              child,
              graceMs: TERM_GRACE_MS,
              markStopped: () => {
                stopped = true;
              },
            }),
        });
      }
    });
  });
}
