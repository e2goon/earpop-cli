import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { APP_ID, appDataDir } from "#/lib/paths.js";
import type { SttRegion } from "#/lib/types.js";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = APP_ID;
// Legacy single-account keychain entry; jp-only fallback (desktop app shared Tokyo key).
const LEGACY_KEYCHAIN_ACCOUNT = "soniox-api-key";

function keychainAccount(region: SttRegion) {
  return `soniox-api-key-${region}`;
}

function credentialsPath(region: SttRegion) {
  return join(appDataDir(), `credentials-${region}`);
}

const SECURITY_NOT_FOUND_EXIT = 44;

function isSecurityNotFound(error: unknown) {
  return Number((error as NodeJS.ErrnoException).code) === SECURITY_NOT_FOUND_EXIT;
}

export async function loadApiKey(region: SttRegion) {
  const fromEnv = process.env.SONIOX_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform === "darwin") {
    const accounts =
      region === "jp"
        ? [keychainAccount(region), LEGACY_KEYCHAIN_ACCOUNT]
        : [keychainAccount(region)];

    for (const account of accounts) {
      try {
        const { stdout } = await execFileAsync("security", [
          "find-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          account,
          "-w",
        ]);
        // Do not hex-decode security -w output: Soniox keys are ASCII hex and were corrupted by false decoding.
        const key = stdout.trim();
        if (key !== "") return key;
      } catch (error) {
        if (!isSecurityNotFound(error)) {
          const err = error as NodeJS.ErrnoException & { stderr?: string };
          throw new Error(
            `Failed to read API key from macOS Keychain: ${err.stderr?.trim() ?? err.message}`,
          );
        }
      }
    }
    return null;
  }

  for (const path of region === "jp"
    ? [credentialsPath(region), join(appDataDir(), "credentials")]
    : [credentialsPath(region)]) {
    try {
      const key = (await readFile(path, "utf8")).trim();
      if (key !== "") return key;
    } catch {}
  }
  return null;
}

// Key is passed as a security argv, so it is briefly visible in `ps` (no stdin support).
export async function saveApiKey({ key, region }: { key: string; region: SttRegion }) {
  const trimmed = key.trim();
  if (trimmed === "") {
    throw new Error("Cannot save an empty API key");
  }

  if (process.platform === "darwin") {
    await execFileAsync("security", [
      "add-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      keychainAccount(region),
      "-w",
      trimmed,
      "-U",
    ]);
    return;
  }

  const path = credentialsPath(region);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, trimmed + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function deleteApiKey(region: SttRegion) {
  if (process.platform === "darwin") {
    try {
      await execFileAsync("security", [
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(region),
      ]);
    } catch (error) {
      if (!isSecurityNotFound(error)) {
        throw error;
      }
    }
    return;
  }

  try {
    await unlink(credentialsPath(region));
  } catch {}
}
