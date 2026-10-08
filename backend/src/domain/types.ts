// Domain types shared across services, repositories and the API layer.
// API-facing shapes must match frontend/src/types.ts (the contract, docs/DESIGN.md §11b).

import type { PriceBand } from "../config/env.js";

export type { PriceBand };

export type HouseholdType = "producer" | "consumer" | "prosumer";
export type OverflowMode = "sell" | "store";

export interface HouseholdSettings {
  overflowMode: OverflowMode; // prosumers only
  minSellPrice: number; // TEC/kWh, limit for surplus sold in the auction (Phase 3)
  maxBuyPrice: number; // TEC/kWh, limit for deficits bought in the auction (Phase 3)
  storeMinPrice: number; // TEC/kWh, limit for stored energy auto-offered in the auction (Phase 3)
  batterySell: { enabled: boolean; minPrice: number; keepPercent: number };
  auctionOptOut: boolean;
}

export interface Household {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  passwordHash: string;
  hederaAccountId: string | null;
  hederaPrivateKeyEncrypted: string | null;
  energyType: string; // "solar", "wind" or "grid"
  currentProduction: number; // kWh, latest reading
  currentConsumption: number; // kWh, latest reading
  batteryCapacityKwh: number;
  batteryKwh: number; // charge of the household's own battery
  storedKwh: number; // the household's rented space in the shared battery
  settings: HouseholdSettings;
  importedKwh: number; // utility statement (real money, off-ledger)
  importCost: number;
  exportedKwh: number;
  exportCredit: number;
  consumedKwh: number; // lifetime consumption
  consumedSolarKwh: number; // of which backed by retired SOLAR certificates
  consumedWindKwh: number; // of which backed by retired WIND certificates
  createdAt: number;
  updatedAt: number;
}

export type AccountKind = "household" | "treasury" | "clearing" | "grid_storage" | "utility";

export interface Account {
  id: string; // Hedera-style: 0.0.n
  kind: AccountKind;
  householdId: string | null;
  label: string;
  balance: number;
  reservedBalance: number;
  solarBalance: number; // SOLAR certificates held (kWh)
  windBalance: number; // WIND certificates held (kWh)
  createdAt: number;
}

export type LedgerTxType =
  | "OPERATOR_FUNDING"
  | "WELCOME_GRANT"
  | "SEED_TOPUP"
  | "TOPUP"
  | "CASHOUT"
  | "TRANSFER"
  | "TRADE_SETTLEMENT"
  | "CERT_ISSUE"
  | "CERT_TRANSFER"
  | "CERT_RETIRE"
  | "AUCTION_SUMMARY";

export type LedgerAsset = "TEC" | "SOLAR" | "WIND" | "RECORD";
export type CertificateAsset = "SOLAR" | "WIND";

export interface CertificateAmounts {
  solar: number;
  wind: number;
}

export interface GreenShare {
  solarKwh: number;
  windKwh: number;
  greyKwh: number;
  percentGreen: number;
}

export interface LedgerTransaction {
  id: string; // Hedera-style: 0.0.1000@seconds.nanos
  type: LedgerTxType;
  asset: LedgerAsset;
  fromAccountId: string | null; // null = created / issued
  toAccountId: string | null; // null = destroyed / retired
  amount: number;
  feeHbar: number;
  memo: string;
  timestamp: number;
  simTime: number;
  blockIndex: number | null;
  relatedTradeId: string | null;
}

export interface LedgerTx {
  id: string;
  type: LedgerTxType;
  asset: LedgerAsset;
  fromAccountId: string | null;
  toAccountId: string | null;
  fromLabel: string;
  toLabel: string;
  amount: number;
  timestamp: number;
  simTime: number;
  feeHbar: number;
  memo: string;
  blockIndex: number | null;
  householdIds: string[];
}

/** API shape of a household (contract: Household in frontend/src/types.ts). */
export interface PublicHousehold {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  energyType: string;
  accountId: string | null;
  currentProduction: number;
  currentConsumption: number;
  batteryCapacityKwh: number;
  batteryChargeKwh: number;
  storedKwh: number;
  reservedInOffersKwh: number;
  listableKwh: number;
  storageSpaceKwh: number;
  tokenBalance: number;
  reservedTec: number;
  settings: HouseholdSettings;
  createdAt: number;
}

export interface EnergyFlow {
  selfUse: number;
  toBattery: number;
  toStorage: number;
  toAuction: number; // Phase 3
  fromBattery: number;
  fromStorage: number;
  toBuy: number; // Phase 3
  sold: number; // Phase 3
  exported: number;
  bought: number; // Phase 3
  imported: number;
  price: number | null; // Phase 3 clearing price
  settled: boolean;
}

export interface EnergyMeasurement {
  id: string;
  householdId: string;
  timestamp: number;
  simTime: number;
  interval: number;
  production: number; // kWh
  consumption: number; // kWh
  surplus: number; // production - consumption
  source: "simulation" | "manual";
  flow: EnergyFlow;
}

export type OfferStatus = "active" | "completed" | "cancelled" | "expired";

export interface EnergyOffer {
  id: string;
  sellerId: string;
  sellerName: string;
  amountKwh: number;
  amountRemainingKwh: number;
  pricePerKwh: number; // TEC/kWh
  status: OfferStatus;
  expiresAtSimTime: number;
  expiresAtInterval: number;
  createdAt: number;
  updatedAt: number;
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
  totalPrice: number; // TEC
  status: TradeStatus;
  ledgerTxId: string | null;
  certificates: CertificateAmounts; // transferred to the buyer with the kWh
  simTime: number;
  createdAt: number;
  completedAt: number | null;
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

export interface UtilityStatement {
  importedKwh: number;
  importCost: number;
  exportedKwh: number;
  exportCredit: number;
  net: number; // credit - cost
}

export interface Wallet {
  householdId: string;
  accountId: string;
  tokenBalance: number;
  reservedTec: number;
  availableTec: number;
  certificates: CertificateAmounts;
  greenShare: GreenShare;
  utility: UtilityStatement;
  topupsEnabled: boolean;
  topupMaxTec: number;
}

export interface LedgerStatus {
  mode: "simulated-hedera";
  network: string;
  operatorAccountId: string;
  tokenIds: { TEC: string; SOLAR: string; WIND: string };
  blocksCount: number;
  transactionsCount: number;
  totalFeesHbar: number;
  latestHash: string;
}

export interface SharedBatteryStatus {
  capacityKwh: number;
  rented: { capacityKwh: number; usedKwh: number; households: number; capPerHouseholdKwh: number };
  gridPool: { capacityKwh: number; chargeKwh: number; greenKwh: number };
  decayPerHour: number;
  avg24h: number;
  gridBuysBelow: number;
  gridSellsAbove: number;
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

export interface MicrogridNode {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  energyType: string;
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

export interface AuthTokenPayload {
  householdId: string;
  type: HouseholdType;
}
