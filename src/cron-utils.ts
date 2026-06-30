// Shared utilities for cron entry points (smart-money-tick / top-trader-tick /
// oi-tick / push-demo). Keeps the per-script boilerplate small so it's hard
// for one script to forget graceful shutdown or storage cleanup.

import { storage } from './storage.js';

/**
 * Wire up SIGTERM / SIGINT so the process closes the DB cleanly when
 * pm2 / docker / Ctrl-C kills it mid-batch.
 *
 * Without this, a kill in the middle of a batch can leave the SQLite WAL
 * file in an inconsistent state, and on rare occasions corrupt the main DB
 * file on next open. Always call this at the start of `main()`.
 */
export function installGracefulShutdown(scriptName: string): void {
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.warn(`[${scriptName}] received ${signal}, closing storage and exiting`);
    try {
      storage.stop();
    } catch (e: any) {
      console.error(`[${scriptName}] storage.stop() failed:`, e?.message ?? e);
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
