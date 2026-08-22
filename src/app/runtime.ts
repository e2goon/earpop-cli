let current: { unmount(): void } | null = null;

export function registerApp(instance: { unmount(): void }) {
  current = instance;
}

// Finalize after unmount so session-end text prints on the restored (non-alternate) screen.
export function quit(finalize?: () => void) {
  try {
    current?.unmount();
  } catch {
    // Still exit even if terminal restore fails.
  }
  finalize?.();
  process.exit(0);
}
