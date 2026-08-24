import { spawn } from "node:child_process";

import { resolveCaptureBin } from "#/lib/capture-bin.js";
import type { Microphone } from "#/lib/types";

const DEVICE_LIST_TIMEOUT_MS = 5_000;

interface ListedMic {
  name?: unknown;
  is_default?: unknown;
}

export async function listMicrophones() {
  const bin = resolveCaptureBin();
  if (!bin.ok) {
    throw new Error(bin.message);
  }

  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin.path, ["list"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out listing microphones after ${DEVICE_LIST_TIMEOUT_MS / 1000}s`));
    }, DEVICE_LIST_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === "ENOENT"
            ? `Failed to run capture helper: ${bin.path}`
            : `Failed to run capture helper: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(stderr.trim() || `Failed to list microphones (exit ${code ?? "unknown"})`),
        );
        return;
      }
      resolve(stdout);
    });
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Capture helper returned invalid microphone list");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Capture helper returned invalid microphone list");
  }

  const microphones: Microphone[] = [];
  for (const item of parsed as ListedMic[]) {
    if (typeof item.name !== "string" || item.name.length === 0) continue;
    microphones.push({
      name: item.name,
      isDefault: item.is_default === true,
    });
  }
  return microphones;
}
