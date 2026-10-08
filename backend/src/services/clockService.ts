import type { Database } from "better-sqlite3";
import { env } from "../config/env.js";

const START_SIM_MINUTES = 6 * 60; // day 1, 06:00 (docs/DESIGN.md §0.6)

/**
 * The microgrid's simulated clock: minutes since day 1 00:00 and an interval
 * counter, persisted in `meta` so it survives restarts. Each interval lasts
 * SIMULATION_MINUTES_PER_TICK simulated minutes.
 *
 * Phase 2: advanced by the simulation tick. Phase 3 gives it its own timer
 * (the market clock) so the auction settles even with the simulation off.
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
    return env.simulationMinutesPerTick;
  }

  /** Real milliseconds until the next interval, assuming the simulation drives it. */
  msUntilNextInterval(): number {
    return Math.max(0, env.simulationTickMs - (Date.now() - this.lastAdvanceAt));
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
