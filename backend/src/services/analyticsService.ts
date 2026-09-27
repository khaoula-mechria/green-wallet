import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import { TradeRepository } from "../db/repositories/tradeRepository.js";
import { TokenTransactionRepository } from "../db/repositories/tokenTransactionRepository.js";
import type { BlockchainService } from "../blockchain/BlockchainService.js";

export interface DashboardSummary {
  totalProducers: number;
  totalConsumers: number;
  totalProsumers: number;
  totalProduction: number;
  totalConsumption: number;
  totalSurplus: number;
  totalDeficit: number;
  activeOffers: number;
  completedTrades: number;
  tokenCirculation: number;
  recentTrades: ReturnType<TradeRepository["findAll"]>;
  blockchain: ReturnType<BlockchainService["getStatus"]>;
}

export class AnalyticsService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;
  private readonly trades: TradeRepository;
  private readonly tokenTx: TokenTransactionRepository;

  constructor(db: Database, private readonly blockchain: BlockchainService) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
    this.trades = new TradeRepository(db);
    this.tokenTx = new TokenTransactionRepository(db);
  }

  getDashboard(): DashboardSummary {
    const households = this.households.findAll();
    const trades = this.trades.findAll();

    let totalProduction = 0;
    let totalConsumption = 0;
    let totalSurplus = 0;
    let totalDeficit = 0;
    let totalProducers = 0;
    let totalConsumers = 0;
    let totalProsumers = 0;
    let tokenCirculation = 0;

    for (const h of households) {
      totalProduction += h.currentProduction;
      totalConsumption += h.currentConsumption;
      const net = h.currentProduction - h.currentConsumption;
      if (net > 0) totalSurplus += net;
      else totalDeficit += Math.abs(net);
      tokenCirculation += h.tokenBalance;

      if (h.type === "producer") totalProducers += 1;
      else if (h.type === "consumer") totalConsumers += 1;
      else totalProsumers += 1;
    }

    return {
      totalProducers,
      totalConsumers,
      totalProsumers,
      totalProduction: round2(totalProduction),
      totalConsumption: round2(totalConsumption),
      totalSurplus: round2(totalSurplus),
      totalDeficit: round2(totalDeficit),
      activeOffers: this.offers.findActive().length,
      completedTrades: trades.filter((t) => t.status === "completed").length,
      tokenCirculation: round2(tokenCirculation),
      recentTrades: trades.slice(0, 10),
      blockchain: this.blockchain.getStatus(),
    };
  }

  getMicrogridView() {
    const households = this.households.findAll();
    return households.map((h) => ({
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      production: h.currentProduction,
      consumption: h.currentConsumption,
      netFlow: round2(h.currentProduction - h.currentConsumption),
      energyBalance: h.energyBalance,
    }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
