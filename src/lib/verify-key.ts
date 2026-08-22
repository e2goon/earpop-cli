import { startSession } from "#/lib/soniox.js";
import type { SttRegion, SttSession } from "#/lib/types.js";

const VERIFY_GRACE_MS = 3_000;

export type KeyVerification = { ok: true } | { ok: false; message: string };

export function verifyApiKey({
  key,
  region,
  model,
}: {
  key: string;
  region: SttRegion;
  model: string;
}) {
  return new Promise<KeyVerification>((resolve) => {
    let session: SttSession | null = null;
    let settled = false;

    const settle = (result: KeyVerification) => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      void session?.stop().catch(() => {});
      resolve(result);
    };

    const grace = setTimeout(() => settle({ ok: true }), VERIFY_GRACE_MS);

    startSession({
      apiKey: key,
      model,
      region,
      onEvent: (event) => {
        if (settled) return;
        if (event.type === "state" && event.state === "error") {
          settle({
            ok: false,
            message:
              event.message ?? "Invalid API key. Check your key at https://console.soniox.com",
          });
        }
      },
    })
      .then((opened) => {
        session = opened;
        if (settled) void opened.stop().catch(() => {});
      })
      .catch((error: unknown) => {
        settle({ ok: false, message: error instanceof Error ? error.message : String(error) });
      });
  });
}
