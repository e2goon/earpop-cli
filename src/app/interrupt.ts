let onInterrupt: () => void = () => process.exit(130);

export function setOnInterrupt(handler: () => void) {
  onInterrupt = handler;
}

// Same press can arrive as both stdin data and SIGINT; real double-taps are slower than this.
const INTERRUPT_DEBOUNCE_MS = 120;
let lastInterruptAt = 0;

function handleInterrupt() {
  const now = Date.now();
  if (now - lastInterruptAt < INTERRUPT_DEBOUNCE_MS) return;
  lastInterruptAt = now;
  onInterrupt();
}

// In ink raw mode Ctrl+C is byte 0x03, not a SIGINT. Wire both; only call from ink app paths
// (TTY data listeners keep stdin flowing and can pin the event loop).
export function installInterruptListeners() {
  if (process.stdin.isTTY) {
    process.stdin.on("data", (chunk) => {
      // Must use a Buffer: String#include(0x03) coerces to "3" and matches the digit key.
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      if (bytes.includes(0x03)) handleInterrupt();
    });
  }
  process.on("SIGINT", () => handleInterrupt());
}
