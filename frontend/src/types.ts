// API contract between the frontend and the backend (see docs/DESIGN.md).
// The in-browser mock (src/mock) implements exactly these shapes, so the
// backend can be brought to the same contract phase by phase.

export type HouseholdType = "producer" | "consumer" | "prosumer";
export type EnergySource = "solar" | "wind" | "grid";
export type OverflowMode = "sell" | "store";

export interface HouseholdSettings {
  overflowMode: OverflowMode; // prosumers only
  minSellPrice: number; // TEC/kWh, limit for surplus sold in the auction
  maxBuyPrice: number; // TEC/kWh, limit for deficits bought in the auction
  storeMinPrice: number; // TEC/kWh, limit for stored energy auto-offered in the auction
  batterySell: { enabled: boolean; minPrice: number; keepPercent: number };
  auctionOptOut: boolean;
}

export interface Household {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  energyType: EnergySource;
  accountId: string; // simulated Hedera account, e.g. 0.0.4801
  currentProduction: number; // kWh, latest reading
  currentConsumption: number; // kWh, latest reading
  batteryCapacityKwh: number;
  batteryChargeKwh: number;
  storedKwh: number; // household's rented space in the shared battery
  reservedInOffersKwh: number;
  listableKwh: number; // what can still be listed on the marketplace
  storageSpaceKwh: number; // free rented space this household can still receive
  tokenBalance: number; // TEC, includes reserved
  reservedTec: number;
  settings: HouseholdSettings;
  createdAt: number;
}

export interface EnergyFlow {
  selfUse: number;
  toBattery: number;
  toStorage: number;
  toAuction: number; // surplus waiting for the end-of-interval auction
  fromBattery: number;
  fromStorage: number;
  toBuy: number; // deficit waiting for the end-of-interval auction
  sold: number;
  exported: number;
  bought: number;
  imported: number;
  price: number | null;
  settled: boolean;
}

export interface EnergyMeasurement {
  id: string;
  householdId: string;
  timestamp: number;
  simTime: number; // simulated minutes since day 1, 00:00
  interval: number;
  production: number;
  consumption: number;
  surplus: number;
  source: "simulation" | "manual";
  flow: EnergyFlow;
}

export interface MeasurementResult {
  measurement: EnergyMeasurement;
  settlesInMs: number;
}

export type OfferStatus = "active" | "completed" | "cancelled" | "expired";

export interface EnergyOffer {
  id: string;
  sellerId: string;
  sellerName: string;
  amountKwh: number;
  amountRemainingKwh: number;
  pricePerKwh: number;
  status: OfferStatus;
  createdAt: number;
  expiresAtSimTime: number;
}

export type TradeStatus = "pending" | "completed" | "failed";

export interface EnergyTrade {
  id: string;
  offerId: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  amountKwh: number;
  pricePerKwh: number;
  totalPrice: number;
  status: TradeStatus;
  ledgerTxId: string | null;
  certificates: { solar: number; wind: number };
  createdAt: number;
  simTime: number;
}

export type LedgerTxType =
  | "OPERATOR_FUNDING"
  | "WELCOME_GRANT"
  | "SEED_TOPUP"
  | "TOPUP"
  | "CASHOUT"
  | "AUCTION_PAYMENT"
  | "AUCTION_PAYOUT"
  | "CLEARING_SWEEP"
  | "TRADE_SETTLEMENT"
  | "CERT_ISSUE"
  | "CERT_TRANSFER"
  | "CERT_RETIRE"
  | "AUCTION_SUMMARY";

export type LedgerAsset = "TEC" | "SOLAR" | "WIND" | "RECORD";

export interface LedgerTx {
  id: string; // Hedera-style transaction ID
  type: LedgerTxType;
  asset: LedgerAsset;
  fromAccountId: string | null; // null = created
  toAccountId: string | null; // null = destroyed / retired
  fromLabel: string;
  toLabel: string;
  amount: number;
  timestamp: number;
  simTime: number;
  feeHbar: number; // simulated, always paid by the operator
  memo: string;
  blockIndex: number | null;
  householdIds: string[];
}

export interface BlockchainBlock {
  index: number;
  timestamp: number;
  simTime: number;
  previousHash: string;
  hash: string;
  nonce: number;
  transactionIds: string[];
}

export interface BlockDetail extends BlockchainBlock {
  transactions: LedgerTx[];
}

export interface LedgerStatus {
  mode: "simulated-hedera" | "hedera";
  network: string;
  operatorAccountId: string;
  tokenIds: { TEC: string; SOLAR: string; WIND: string };
  blocksCount: number;
  transactionsCount: number;
  totalFeesHbar: number;
  latestHash: string;
}

export interface PriceComponents {
  wholesale: number;
  networkFee: number;
  taxes: number;
  supplierMargin: number;
  balancingCost: number;
}

export interface PriceBand {
  floor: number;
  ceiling: number;
  mid: number;
  components: PriceComponents;
}

export interface MarketStatus {
  simTime: number;
  interval: number;
  intervalMs: number;
  nextSettlementInMs: number;
  paused: boolean;
  band: PriceBand;
  lastPrice: number | null;
  avg24h: number;
  mockMode: boolean;
}

export interface PricePoint {
  interval: number;
  simTime: number;
  price: number | null;
  volume: number;
  exportedKwh: number;
  importedKwh: number;
  avg24h: number;
}

export type BidSide = "sell" | "buy";
export type BidSource = "surplus" | "storage" | "battery" | "grid-pool" | "deficit";

export interface AuctionBid {
  id: string;
  participantId: string;
  participantName: string;
  participantType: HouseholdType | "operator";
  side: BidSide;
  source: BidSource;
  quantity: number;
  limitPrice: number;
  matched: number;
}

export interface AuctionResult {
  interval: number;
  simTime: number;
  clearingPrice: number | null;
  volume: number;
  lastMatchedSellPrice: number | null;
  lastMatchedBuyPrice: number | null;
  bids: AuctionBid[];
  exportedKwh: number;
  importedKwh: number;
}

export interface SharedBatteryStatus {
  capacityKwh: number;
  rented: { capacityKwh: number; usedKwh: number; households: number; capPerHouseholdKwh: number };
  gridPool: { capacityKwh: number; chargeKwh: number; greenKwh: number };
  decayPerHour: number;
  avg24h: number;
  gridBuysBelow: number; // TEC/kWh, current buy limit of the grid pool
  gridSellsAbove: number; // TEC/kWh, current sell limit of the grid pool
}

export interface UtilityStatement {
  importedKwh: number;
  importCost: number;
  exportedKwh: number;
  exportCredit: number;
  net: number; // credit - cost
}

export interface GreenShare {
  solarKwh: number;
  windKwh: number;
  greyKwh: number;
  percentGreen: number;
}

export interface Wallet {
  householdId: string;
  accountId: string;
  tokenBalance: number;
  reservedTec: number;
  availableTec: number;
  certificates: { solar: number; wind: number }; // held with stored/battery energy
  greenShare: GreenShare;
  utility: UtilityStatement;
  topupsEnabled: boolean;
  topupMaxTec: number;
}

export interface MicrogridNode {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  energyType: EnergySource;
  production: number;
  consumption: number;
  netFlow: number;
  batteryCapacityKwh: number;
  batteryChargeKwh: number;
  storedKwh: number;
  overflowMode: OverflowMode | null;
}

export interface ConservationChecks {
  money: { ok: boolean; totalSupply: number; sumOfBalances: number };
  clearing: { ok: boolean; balance: number };
  energy: { ok: boolean; inputs: number; outputs: number };
  certificates: { ok: boolean; issued: number; accounted: number };
  noNegative: { ok: boolean };
}

export interface DashboardSummary {
  counts: { producers: number; prosumers: number; consumers: number };
  simTime: number;
  interval: number;
  production: number;
  consumption: number;
  lastPrice: number | null;
  avg24h: number;
  band: PriceBand;
  greenShare: GreenShare;
  tokenCirculation: number;
  treasuryBalance: number;
  activeOffers: number;
  completedTrades: number;
  sharedBattery: SharedBatteryStatus;
  checks: ConservationChecks;
  recentTrades: EnergyTrade[];
}

export interface MyBidPreview {
  side: BidSide | null;
  bids: Array<{ source: BidSource; quantity: number; limitPrice: number }>;
  pendingSellKwh: number;
  pendingBuyKwh: number;
  reservedTec: number;
  optedOut: boolean;
}

export interface RegisterInput {
  name: string;
  type: HouseholdType;
  location: string;
  password: string;
  energyType?: EnergySource;
  batteryCapacityKwh?: number;
}
