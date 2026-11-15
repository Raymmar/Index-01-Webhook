/** Server sends a heartbeat every 20 seconds. A silent connection must reconnect. */
export async function withStreamDeadline<T>(
  operation: Promise<T>,
  abort: () => void,
  milliseconds = 65_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Live connection stopped responding'));
          abort();
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
