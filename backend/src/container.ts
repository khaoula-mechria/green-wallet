import type { Database } from "better-sqlite3";
import { createBlockchainService } from "./blockchain/index.js";
import type { BlockchainService } from "./blockchain/BlockchainService.js";
import { LedgerService } from "./services/ledgerService.js";
import { AuthService } from "./services/authService.js";
import { HouseholdService } from "./services/householdService.js";
import { TokenService } from "./services/tokenService.js";
import { MeasurementService } from "./services/measurementService.js";
import { MarketplaceService } from "./services/marketplaceService.js";
import { TradeService } from "./services/tradeService.js";
import { AnalyticsService } from "./services/analyticsService.js";
import { SimulationService } from "./simulation/simulationService.js";
import { NotificationHub } from "./ws/notificationHub.js";

export interface Container {
  db: Database;
  blockchain: BlockchainService;
  ledger: LedgerService;
  auth: AuthService;
  households: HouseholdService;
  tokens: TokenService;
  measurements: MeasurementService;
  marketplace: MarketplaceService;
  trades: TradeService;
  analytics: AnalyticsService;
  simulation: SimulationService;
  notifications: NotificationHub;
}

export function createContainer(db: Database): Container {
  const blockchain = createBlockchainService(db);
  const ledger = new LedgerService(db);
  ledger.bootstrap(); // Initialize operator accounts
  const auth = new AuthService(db, ledger);
  const households = new HouseholdService(db);
  const tokens = new TokenService(db, ledger);
  const measurements = new MeasurementService(db, tokens);
  const marketplace = new MarketplaceService(db);
  const trades = new TradeService(db, tokens);
  const analytics = new AnalyticsService(db, ledger);
  const simulation = new SimulationService(db, measurements);
  const notifications = new NotificationHub();

  return { db, blockchain, ledger, auth, households, tokens, measurements, marketplace, trades, analytics, simulation, notifications };
}
