import { homedir } from "node:os";
import { join } from "node:path";

export const APP_ID = "com.earpop.app";

export function appDataDir() {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", APP_ID)
    : join(homedir(), ".earpop");
}
