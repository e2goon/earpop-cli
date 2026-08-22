import { spawn } from "node:child_process";

import { FFMPEG_MISSING } from "#/lib/audio";
import type { Microphone } from "#/lib/types";

const DEVICE_LINE = /^\[AVFoundation indev @ [^\]]+\] \[\d+\] (.+)$/;

const DEVICE_LIST_TIMEOUT_MS = 5_000;

interface SpAudioItem {
  _name?: string;
  coreaudio_device_input?: string;
  coreaudio_default_audio_input_device?: string;
  _items?: SpAudioItem[];
}

function listAvfoundationDevices() {
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-f",
      "avfoundation",
      "-list_devices",
      "true",
      "-i",
      "",
    ]);
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out listing microphones after ${DEVICE_LIST_TIMEOUT_MS / 1000}s`));
    }, DEVICE_LIST_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === "ENOENT" ? FFMPEG_MISSING : `Failed to run ffmpeg: ${error.message}`,
        ),
      );
    });
    child.on("close", () => {
      clearTimeout(timer);
      const lines = stderr.split("\n");
      const audioStart = lines.findIndex((line) => line.includes("AVFoundation audio devices:"));
      if (audioStart === -1) {
        reject(new Error(`Failed to list microphones: ${stderr.trim()}`));
        return;
      }
      const names: string[] = [];
      for (const line of lines.slice(audioStart + 1)) {
        const match = DEVICE_LINE.exec(line);
        if (match) names.push(match[1]!);
      }
      resolve(names);
    });
  });
}

async function defaultInputDeviceName() {
  return new Promise<string | null>((resolve) => {
    const child = spawn("system_profiler", ["SPAudioDataType", "-json"]);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout) as { SPAudioDataType?: SpAudioItem[] };
        const found = findDefaultInput(parsed.SPAudioDataType ?? []);
        resolve(found?._name ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

function findDefaultInput(items: SpAudioItem[]): SpAudioItem | null {
  for (const item of items) {
    const hasInput = Number(item.coreaudio_device_input ?? 0) > 0;
    if (hasInput && item.coreaudio_default_audio_input_device === "spaudio_yes") return item;
    const child = item._items ? findDefaultInput(item._items) : null;
    if (child) return child;
  }
  return null;
}

export async function listMicrophones() {
  const names = await listAvfoundationDevices();
  const defaultName = await defaultInputDeviceName();
  const microphones: Microphone[] = names.map((name) => ({
    name,
    isDefault: name === defaultName,
  }));
  return microphones;
}
