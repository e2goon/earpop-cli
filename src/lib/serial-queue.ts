export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(op: () => Promise<T>) => {
    const run = tail.then(op);
    tail = run.catch(() => undefined);
    return run;
  };
}
