import { useInput } from "ink";
import { useEffect } from "react";

import { handleInterrupt, setOnInterrupt } from "#/app/interrupt.js";

/**
 * Wire Ctrl+C through Ink's key parser (digit `3` ≠ Ctrl+C / 0x03).
 * SIGINT remains on `installInterruptListeners` for non-raw signals.
 */
export function useInterrupt(handler: () => void) {
  useEffect(() => {
    setOnInterrupt(handler);
    return () => {
      setOnInterrupt(() => process.exit(130));
    };
  }, [handler]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") handleInterrupt();
  });
}
