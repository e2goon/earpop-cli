import { killCapture, spawnCapture, spawnFailureMessage } from "#/lib/capture-process.js";
import type { Microphone } from "#/lib/types";

const DEVICE_LIST_TIMEOUT_MS = 5_000;

interface ListedMic {
  name?: unknown;
  is_default?: unknown;
}

export async function listMicrophones() {
  const child = spawnCapture(["list"]);

  const raw = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killCapture({ child, force: true });
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
      reject(new Error(spawnFailureMessage({ child, error })));
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
    parsed = JSON.parse(raw);
  } catch {}
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
