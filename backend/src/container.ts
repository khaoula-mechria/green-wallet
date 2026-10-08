import type { Database } from "better-sqlite3";
import { createBlockchainService } from "./blockchain/index.js";
import type { BlockchainService } from "./blockchain/BlockchainService.js";
import { ClockService } from "./services/clockService.js";
import { LedgerService } from "./services/ledgerService.js";
import { CertificateService } from "./services/certificateService.js";
import { GridService } from "./services/gridService.js";
import { AuctionService } from "./services/auctionService.js";
import { AuthService } from "./services/authService.js";
import { HouseholdService } from "./services/householdService.js";
import { TokenService } from "./services/tokenService.js";
import { MeasurementService } from "./services/measurementService.js";
import { MarketplaceService } from "./services/marketplaceService.js";
import { TradeService } from "./services/tradeService.js";
import { MarketService } from "./services/marketService.js";
import { AnalyticsService } from "./services/analyticsService.js";
import { SimulationService } from "./simulation/simulationService.js";
import { NotificationHub } from "./ws/notificationHub.js";

export interface Container {
  db: Database;
  blockchain: BlockchainService;
  clock: ClockService;
  ledger: LedgerService;
  certificates: CertificateService;
  grid: GridService;
  auction: AuctionService;
  auth: AuthService;
  households: HouseholdService;
  tokens: TokenService;
  measurements: MeasurementService;
  marketplace: MarketplaceService;
  trades: TradeService;
  market: MarketService;
  analytics: AnalyticsService;
  simulation: SimulationService;
  notifications: NotificationHub;
}

export function createContainer(db: Database): Container {
  const blockchain = createBlockchainService(db);
  const clock = new ClockService(db);
  const ledger = new LedgerService(db, clock);
  ledger.bootstrap(); // operator accounts and initial funding
  const certificates = new CertificateService(db, ledger);
  const grid = new GridService(db, ledger, certificates, clock);
  const auction = new AuctionService(db, ledger, certificates, grid, clock);
  const households = new HouseholdService(db, grid, auction);
  const auth = new AuthService(db, ledger, households);
  const tokens = new TokenService(db, ledger);
  const measurements = new MeasurementService(db, ledger, certificates, grid, clock, auction);
  const marketplace = new MarketplaceService(db, grid, clock);
  const trades = new TradeService(db, ledger, certificates, grid, clock);
  const market = new MarketService(db, clock, grid, auction);
  const analytics = new AnalyticsService(db, ledger, grid, clock, auction);
  const simulation = new SimulationService(db, measurements, market, clock);
  const notifications = new NotificationHub();

  return {
    db,
    blockchain,
    clock,
    ledger,
    certificates,
    grid,
    auction,
    auth,
    households,
    tokens,
    measurements,
    marketplace,
    trades,
    market,
    analytics,
    simulation,
    notifications,
  };
}
