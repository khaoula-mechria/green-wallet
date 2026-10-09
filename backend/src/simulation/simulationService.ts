import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { MeasurementService } from "../services/measurementService.js";
import type { MarketService } from "../services/marketService.js";
import type { ClockService } from "../services/clockService.js";
import { simulateReading } from "./curves.js";
import { env, priceBand } from "../config/env.js";
import type { MarketplaceService } from "../services/marketplaceService.js";
import type { TradeService } from "../services/tradeService.js";
import type { GridService } from "../services/gridService.js";
import type { LedgerService } from "../services/ledgerService.js";

/** What the demo neighbours need: the same services a person uses. */
export interface DemoMarketDeps {
  marketplace: MarketplaceService;
  trades: TradeService;
  grid: GridService;
  ledger: LedgerService;
}

/**
 * Drives the physical-energy layer of the demo: at the start of every market
 * interval it records one meter reading per household from its role's energy
 * profile (solar farm, wind farm, rooftop prosumer, consumer). The market clock
 * (MarketService) owns time and settles each interval; the simulated clock runs
 * much faster than real time, so a full day plays out in a few minutes.
 */
export class SimulationService {
  private readonly households: HouseholdRepository;
  private unsubscribe: (() => void) | null = null;

  constructor(
    db: Database,
    private readonly measurementService: MeasurementService,
    private readonly market: MarketService,
    private readonly clock: ClockService,
    private readonly demo?: DemoMarketDeps
  ) {
    this.households = new HouseholdRepository(db);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.market.onIntervalStart(async () => {
      await this.recordReadings();
      if (env.demoMarketEnabled) await this.demoMarket();
    });
    console.log("[simulation] started: one simulated reading per household every market interval");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getSimulatedHourOfDay(): number {
    return (this.clock.simTime() % 1440) / 60;
  }

  /** Readings for the current interval, from each household's energy profile. */
  async recordReadings(): Promise<void> {
    const hourOfDay = this.getSimulatedHourOfDay();
    for (const h of this.households.findAll()) {
      const { production, consumption } = simulateReading(h, hourOfDay, Math.random);
      await this.measurementService.record(h.id, production, consumption, "simulation");
    }
  }

  /**
   * Demo-only neighbours, so the marketplace is never empty: every two simulated hours a
   * prosumer with stored energy lists some of it, every ninety minutes a neighbour buys
   * from an open offer, and once a simulated day wallets that ran dry get a simulated
   * top-up. Everything goes through the normal services, so every market rule applies.
   * Only the live loop calls it (start), never runInterval, so tests stay deterministic.
   */
  async demoMarket(listOnly = false): Promise<void> {
    const d = this.demo;
    if (!d) return;
    const homes = this.households.findAll().filter((h) => h.type !== "producer");
    const interval = this.clock.interval();
    const available = (id: string) => d.ledger.getBalance(d.ledger.getHouseholdAccount(id).id).available;

    if (!listOnly && this.clock.simTime() % 1440 === 0) {
      for (const h of homes) {
        if (available(h.id) < 5) d.ledger.transfer("TOPUP", null, d.ledger.getHouseholdAccount(h.id).id, 20, "Monthly top-up (simulated)");
      }
    }

    if (listOnly || interval % 4 === 0) {
      const band = priceBand();
      for (const h of homes) {
        if (h.type !== "prosumer" || d.marketplace.getOffersBySeller(h.id).some((o) => o.status === "active")) continue;
        const kwh = Math.floor(Math.min(3, d.grid.listable(h) * 0.5) * 10) / 10;
        if (kwh < 0.1) continue;
        const price = Math.min(band.ceiling, Math.max(band.floor, Math.round(d.grid.avg24h() * (1.05 + Math.random() * 0.15) * 1000) / 1000));
        try {
          d.marketplace.createOffer(h.id, kwh, price);
        } catch {
          // not enough listable energy after all: skip this one
        }
      }
    }

    if (!listOnly && interval % 3 === 1) {
      const buyers = homes.filter((h) => available(h.id) > 1).sort(() => Math.random() - 0.5);
      for (const o of d.marketplace.getActiveOffers().slice(0, 2)) {
        const buyer = buyers.find((b) => b.id !== o.sellerId);
        if (!buyer) break;
        const kwh = Math.floor(Math.min(o.amountRemainingKwh, d.grid.storageSpace(buyer), 1.5, available(buyer.id) / o.pricePerKwh) * 10) / 10;
        if (kwh < 0.1) continue;
        try {
          await d.trades.purchase(buyer.id, o.id, kwh);
        } catch {
          // the buyer can't take it right now: try again later
        }
      }
    }
  }

  /** One full interval without timers (tests, scripts): settle the current one, then record the next. */
  async runInterval(): Promise<void> {
    this.market.endInterval();
    await this.recordReadings();
  }
}
