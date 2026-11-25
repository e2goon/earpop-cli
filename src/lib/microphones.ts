import { killCapture, spawnCapture, spawnFailureMessage } from "#/lib/capture-process.js";
import type { Microphone } from "#/lib/types.js";

const DEVICE_LIST_TIMEOUT_MS = 5_000;
const MAX_STDOUT_CHARS = 1_048_576;
const MAX_STDERR_CHARS = 8_192;

interface ListedMic {
  name?: unknown;
  is_default?: unknown;
}

export async function listMicrophones() {
  const child = spawnCapture(["list"]);

  const raw = await new Promise<string>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (outcome: { ok: true; value: string } | { ok: false; error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const timer = setTimeout(() => {
      killCapture({ child, force: true });
      finish({
        ok: false,
        error: new Error(`Timed out listing microphones after ${DEVICE_LIST_TIMEOUT_MS / 1000}s`),
      });
    }, DEVICE_LIST_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDOUT_CHARS) {
        killCapture({ child, force: true });
        finish({
          ok: false,
          error: new Error("Capture helper exceeded microphone list output limit"),
        });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CHARS);
      }
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ ok: false, error: new Error(spawnFailureMessage({ child, error })) });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          error: new Error(
            stderr.trim() || `Failed to list microphones (exit ${code ?? "unknown"})`,
          ),
        });
        return;
      }
      finish({ ok: true, value: stdout });
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
