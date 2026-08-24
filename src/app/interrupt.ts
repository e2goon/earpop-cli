let onInterrupt: () => void = () => process.exit(130);

export function setOnInterrupt(handler: () => void) {
  onInterrupt = handler;
}

// Same press can arrive as both parsed Ctrl+C and SIGINT; real double-taps are slower than this.
const INTERRUPT_DEBOUNCE_MS = 120;
let lastInterruptAt = 0;

export function handleInterrupt() {
  const now = Date.now();
  if (now - lastInterruptAt < INTERRUPT_DEBOUNCE_MS) return;
  lastInterruptAt = now;
  onInterrupt();
}

/** Non-UI path (e.g. `kill -INT`). Raw-mode Ctrl+C is handled via Ink `useInput`. */
export function installInterruptListeners() {
  process.on("SIGINT", () => handleInterrupt());
}
