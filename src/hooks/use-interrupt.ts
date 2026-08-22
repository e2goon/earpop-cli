import { useEffect } from "react";

import { setOnInterrupt } from "#/app/interrupt.js";

export function useInterrupt(handler: () => void) {
  useEffect(() => {
    setOnInterrupt(handler);
    return () => {
      setOnInterrupt(() => process.exit(130));
    };
  }, [handler]);
}
