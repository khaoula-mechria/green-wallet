import type { Database } from "better-sqlite3";
import { createBlockchainService } from "./blockchain/index.js";
import type { BlockchainService } from "./blockchain/BlockchainService.js";
import { AuthService } from "./services/authService.js";
import { HouseholdService } from "./services/householdService.js";
import { TokenService } from "./services/tokenService.js";
import { MeasurementService } from "./services/measurementService.js";
import { MarketplaceService } from "./services/marketplaceService.js";
import { TradeService } from "./services/tradeService.js";
import { AnalyticsService } from "./services/analyticsService.js";
import { LedgerMaintenanceService } from "./services/ledgerMaintenanceService.js";
import { SimulationService } from "./simulation/simulationService.js";
import { NotificationHub } from "./ws/notificationHub.js";
import { env } from "./config/env.js";

export interface Container {
  db: Database;
  blockchain: BlockchainService;
  auth: AuthService;
  households: HouseholdService;
  tokens: TokenService;
  measurements: MeasurementService;
  marketplace: MarketplaceService;
  trades: TradeService;
  analytics: AnalyticsService;
  ledger: LedgerMaintenanceService;
  simulation: SimulationService;
  notifications: NotificationHub;
}

export function createContainer(db: Database, blockchain: BlockchainService = createBlockchainService(db)): Container {
  const tokens = new TokenService(db, blockchain);
  const auth = new AuthService(db, blockchain, tokens);
  const households = new HouseholdService(db);
  const measurements = new MeasurementService(db, tokens);
  const marketplace = new MarketplaceService(db);
  const trades = new TradeService(db, tokens);
  const analytics = new AnalyticsService(db, blockchain);
  const ledger = new LedgerMaintenanceService(db, blockchain, trades, { pendingTradeTimeoutMs: env.pendingTradeTimeoutMs });
  const simulation = new SimulationService(db, measurements);
  const notifications = new NotificationHub();

  return { db, blockchain, auth, households, tokens, measurements, marketplace, trades, analytics, ledger, simulation, notifications };
}
