import type { Database } from "better-sqlite3";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import type { AuctionResult, MarketStatus } from "../domain/types.js";
import { env, priceBand } from "../config/env.js";
import type { ClockService } from "./clockService.js";
import type { GridService } from "./gridService.js";
import type { AuctionService } from "./auctionService.js";

type IntervalHook = () => Promise<void> | void;

/**
 * The market clock (docs/DESIGN.md §0.6). Every MARKET_INTERVAL_MS it closes the
 * current interval — storage decay, the auction, clock advance, offer expiry —
 * then lets listeners (the simulation) record the next interval's readings.
 * It runs whether or not the simulation is on, so manual readings settle too.
 */
export class MarketService {
  private readonly offers: OfferRepository;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private hooks: IntervalHook[] = [];

  constructor(
    private readonly db: Database,
    private readonly clock: ClockService,
    private readonly grid: GridService,
    private readonly auction: AuctionService
  ) {
    this.offers = new OfferRepository(db);
  }

  start(): void {
    if (this.timer) return;
    this.clock.resetCountdown();
    this.timer = setInterval(() => void this.tick(), env.marketIntervalMs);
    console.log(`[market] clock started: an auction every ${env.marketIntervalMs}ms (${env.marketIntervalSimMinutes} simulated minutes)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Called with every new interval, after the previous one settled. Returns an unsubscribe. */
  onIntervalStart(hook: IntervalHook): () => void {
    this.hooks.push(hook);
    return () => {
      this.hooks = this.hooks.filter((h) => h !== hook);
    };
  }

  /** Closes the current interval and opens the next one, atomically. */
  endInterval(): { auction: AuctionResult; simTime: number; interval: number; decayedKwh: number; expiredOffers: number } {
    return this.db.transaction(() => {
      const { decayedKwh } = this.grid.applyDecay();
      const auction = this.auction.settle();
      const { simTime, interval } = this.clock.advance();
      const expiredOffers = this.offers.expireDue(interval, Date.now());
      return { auction, simTime, interval, decayedKwh, expiredOffers };
    })();
  }

  /** endInterval, then the listeners for the new interval. */
  async runInterval(): Promise<void> {
    this.endInterval();
    for (const hook of this.hooks) await hook();
  }

  status(): MarketStatus {
    return {
      simTime: this.clock.simTime(),
      interval: this.clock.interval(),
      intervalMs: env.marketIntervalMs,
      nextSettlementInMs: this.timer ? this.clock.msUntilNextInterval() : 0,
      paused: this.timer === null,
      band: priceBand(),
      lastPrice: this.auction.lastPrice(),
      avg24h: this.grid.avg24h(),
      mockMode: false,
    };
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return; // never overlap two settlements
    this.inFlight = true;
    try {
      await this.runInterval();
    } catch (err) {
      console.error("[market] interval settlement failed:", (err as Error).message);
    } finally {
      this.inFlight = false;
    }
  }
}
