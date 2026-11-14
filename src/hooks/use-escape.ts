import { useInput } from "ink";

/** Calls `handler` on ESC while `active` (default true). */
export function useEscape({ handler, active = true }: { handler: () => void; active?: boolean }) {
  useInput(
    (_input, key) => {
      if (key.escape) handler();
    },
    { isActive: active },
  );
}
