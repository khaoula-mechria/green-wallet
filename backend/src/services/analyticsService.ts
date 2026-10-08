import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import { TradeRepository } from "../db/repositories/tradeRepository.js";
import { AccountRepository } from "../db/repositories/accountRepository.js";
import { CLEARING_ACCOUNT, type LedgerService } from "./ledgerService.js";
import { greenShareOf } from "./certificateService.js";
import type { GridService } from "./gridService.js";
import type { ClockService } from "./clockService.js";
import type { AuctionService } from "./auctionService.js";
import type { ConservationChecks, DashboardSummary, MicrogridNode } from "../domain/types.js";
import { priceBand } from "../config/env.js";

/** System-wide views: the dashboard (with the §9 conservation checks) and the microgrid map. */
export class AnalyticsService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;
  private readonly trades: TradeRepository;
  private readonly accounts: AccountRepository;

  constructor(
    db: Database,
    private readonly ledger: LedgerService,
    private readonly grid: GridService,
    private readonly clock: ClockService,
    private readonly auction: AuctionService
  ) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
    this.trades = new TradeRepository(db);
    this.accounts = new AccountRepository(db);
  }

  getDashboard(): DashboardSummary {
    const households = this.households.findAll();
    const trades = this.trades.findAll();
    const band = priceBand();
    const count = (type: string) => households.filter((h) => h.type === type).length;

    return {
      counts: { producers: count("producer"), prosumers: count("prosumer"), consumers: count("consumer") },
      simTime: this.clock.simTime(),
      interval: this.clock.interval(),
      production: round2(households.reduce((s, h) => s + h.currentProduction, 0)),
      consumption: round2(households.reduce((s, h) => s + h.currentConsumption, 0)),
      lastPrice: this.auction.lastPrice(),
      avg24h: this.grid.avg24h(),
      band,
      greenShare: greenShareOf(households),
      tokenCirculation: round2(this.accounts.findByKind("household").reduce((s, a) => s + a.balance, 0)),
      treasuryBalance: this.ledger.treasuryBalance(),
      activeOffers: this.offers.findActive().length,
      completedTrades: trades.filter((t) => t.status === "completed").length,
      sharedBattery: this.grid.status(),
      checks: this.checks(),
      recentTrades: trades.filter((t) => t.status === "completed").slice(0, 8),
    };
  }

  /** docs/DESIGN.md §9 — the five conservation checks. */
  checks(): ConservationChecks {
    const clearing = round2(this.ledger.getBalance(CLEARING_ACCOUNT).balance) + 0; // + 0 turns -0 into 0
    const accounts = this.accounts.findAll();
    return {
      money: this.ledger.checkMoneyInvariant(),
      clearing: { ok: Math.abs(clearing) < 0.011, balance: clearing },
      energy: this.grid.checkEnergy(),
      certificates: this.ledger.checkCertificateInvariant(),
      noNegative: {
        ok:
          accounts.every((a) => a.balance >= -1e-9 && a.solarBalance >= -1e-9 && a.windBalance >= -1e-9) &&
          this.grid.noNegativeStocks(),
      },
    };
  }

  getMicrogridView(): MicrogridNode[] {
    return this.households.findAll().map((h) => ({
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      energyType: h.energyType,
      production: h.currentProduction,
      consumption: h.currentConsumption,
      netFlow: round2(h.currentProduction - h.currentConsumption),
      batteryCapacityKwh: h.batteryCapacityKwh,
      batteryChargeKwh: round3(h.batteryKwh),
      storedKwh: round3(h.storedKwh),
      overflowMode: h.type === "prosumer" ? h.settings.overflowMode : null,
    }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
