import type { Database } from "better-sqlite3";
import { env } from "../config/env.js";

const START_SIM_MINUTES = 6 * 60; // day 1, 06:00 (docs/DESIGN.md §0.6)

/**
 * The microgrid's simulated clock: minutes since day 1 00:00 and an interval
 * counter, persisted in `meta` so it survives restarts. Each interval lasts
 * MARKET_INTERVAL_SIM_MINUTES simulated minutes and MARKET_INTERVAL_MS real
 * milliseconds; MarketService advances it at the end of every interval.
 */
export class ClockService {
  private lastAdvanceAt = Date.now();

  constructor(private readonly db: Database) {
    const insert = db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)`);
    insert.run("simTime", String(START_SIM_MINUTES));
    insert.run("interval", "0");
  }

  simTime(): number {
    return this.read("simTime");
  }

  interval(): number {
    return this.read("interval");
  }

  minutesPerInterval(): number {
    return env.marketIntervalSimMinutes;
  }

  /** Intervals in one simulated day (the 24-hour window of the grid pool trader). */
  intervalsPerDay(): number {
    return Math.round(1440 / this.minutesPerInterval());
  }

  /** Real milliseconds until the current interval settles. */
  msUntilNextInterval(): number {
    return Math.max(0, env.marketIntervalMs - (Date.now() - this.lastAdvanceAt));
  }

  /** Restarts the real-time countdown (when the market clock starts). */
  resetCountdown(): void {
    this.lastAdvanceAt = Date.now();
  }

  advance(): { simTime: number; interval: number } {
    const simTime = this.simTime() + this.minutesPerInterval();
    const interval = this.interval() + 1;
    const write = this.db.prepare(`UPDATE meta SET value = ? WHERE key = ?`);
    this.db.transaction(() => {
      write.run(String(simTime), "simTime");
      write.run(String(interval), "interval");
    })();
    this.lastAdvanceAt = Date.now();
    return { simTime, interval };
  }

  private read(key: string): number {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }
}
