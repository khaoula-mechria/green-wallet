import type { Database } from "better-sqlite3";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import type { MarketStatus } from "../domain/types.js";
import { env, priceBand } from "../config/env.js";
import type { ClockService } from "./clockService.js";
import type { GridService } from "./gridService.js";

/**
 * The market's interval cycle (docs/DESIGN.md §0.6, §4). Phase 2: at the end of
 * every interval stored energy decays and expired offers close; Phase 3 adds the
 * auction clearing here.
 */
export class MarketService {
  private readonly offers: OfferRepository;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly clock: ClockService,
    private readonly grid: GridService
  ) {
    this.offers = new OfferRepository(db);
  }

  /** Closes the current interval and opens the next one. */
  endInterval(): { simTime: number; interval: number; decayedKwh: number; expiredOffers: number } {
    return this.db.transaction(() => {
      const { decayedKwh } = this.grid.applyDecay();
      const { simTime, interval } = this.clock.advance();
      const expiredOffers = this.offers.expireDue(interval, Date.now());
      return { simTime, interval, decayedKwh, expiredOffers };
    })();
  }

  /** Set by the simulation, which drives the clock in Phase 2. */
  setRunning(running: boolean): void {
    this.running = running;
  }

  status(): MarketStatus {
    const band = priceBand();
    return {
      simTime: this.clock.simTime(),
      interval: this.clock.interval(),
      intervalMs: env.simulationTickMs,
      nextSettlementInMs: this.running ? this.clock.msUntilNextInterval() : 0,
      paused: !this.running,
      band,
      lastPrice: null, // no auction until Phase 3
      avg24h: band.mid,
      mockMode: false,
    };
  }
}
