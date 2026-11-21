import type { pool as databasePool } from "@workspace/db";
type Pool = typeof databasePool;
const getConnection = (pool: Pool) => pool.connect();
type PoolClient = Awaited<ReturnType<typeof getConnection>>;

/** Notifications wake work; the database queue remains the durable authority. */
export function startJobWakeups({ pool, drain, nextDeadline, onError }: {
  pool: Pool;
  drain: () => Promise<boolean>;
  nextDeadline: () => Promise<number | null>;
  onError: () => void;
}) {
  let stopped = false;
  let running = false;
  let requested = false;
  let client: PoolClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let closeConnection: (() => void) | undefined;

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(wake, Math.min(2_147_483_647, Math.max(50, delay)));
    timer.unref();
  }
  function wake() {
    if (stopped) return;
    requested = true;
    clearTimeout(timer);
    if (!running) void run();
  }
  async function run() {
    running = true;
    try {
      do {
        requested = false;
        // Drain consecutive ready jobs without an artificial gap between them.
        while (!stopped && await drain()) {}
        if (stopped) break;
        const deadline = await nextDeadline();
        if (deadline !== null) schedule(deadline - Date.now());
        // A notification arriving during the final reads must not be lost.
      } while (requested && !stopped);
    } catch {
      if (!stopped) { onError(); schedule(5_000); }
    } finally { running = false; }
  }
  async function connect() {
    let connection: PoolClient | undefined;
    let released = false;
    const disconnect = () => {
      if (released) return;
      released = true;
      if (client === connection) client = undefined;
      connection?.release(true);
      if (!stopped) {
        onError();
        reconnect = setTimeout(() => void connect(), Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
        reconnect.unref();
      }
    };
    try {
      connection = await pool.connect();
      if (stopped) { connection.release(true); return; }
      client = connection;
      closeConnection = disconnect;
      connection.on("error", disconnect);
      connection.on("end", disconnect);
      connection.on("notification", event => {
        if (event.channel === "ring_inbox_changed") wake();
      });
      await connection.query("LISTEN ring_inbox_changed");
      if (released || stopped) return;
      failures = 0;
      // Listen first, then catch up: covers startup and missed notifications.
      wake();
    } catch { disconnect(); }
  }
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(reconnect);
    closeConnection?.();
    client = undefined;
  };
}
