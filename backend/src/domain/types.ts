// Domain types shared across services, repositories and API layer.
// "Household" in the functional spec == "Factory" in this implementation's
// terminology (chosen to match the real reference architecture this project
// builds on — see BLOCKCHAIN_ENERGY_TRADING_DEEP_DIVE.md).

export type HouseholdType = "producer" | "consumer" | "prosumer";

export interface Household {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  passwordHash: string;
  hederaAccountId: string | null;
  hederaPrivateKeyEncrypted: string | null;
  energyType: string; // e.g. "solar", "wind", "grid"
  currentProduction: number; // kWh, latest measurement snapshot
  currentConsumption: number; // kWh, latest measurement snapshot
  energyBalance: number; // kWh available to sell (tokenized surplus, banked)
  createdAt: number;
  updatedAt: number;
}

export type AccountKind = "household" | "treasury" | "clearing" | "grid_storage";

export interface Account {
  id: string; // Hedera-style: 0.0.n
  kind: AccountKind;
  householdId: string | null;
  label: string;
  balance: number;
  reservedBalance: number;
  createdAt: number;
}

export type LedgerTxType =
  | "OPERATOR_FUNDING"
  | "WELCOME_GRANT"
  | "SEED_TOPUP"
  | "TOPUP"
  | "CASHOUT"
  | "MINT"
  | "TRANSFER"
  | "TRADE_SETTLEMENT"
  | "CERT_ISSUE"
  | "CERT_TRANSFER"
  | "CERT_RETIRE"
  | "AUCTION_SUMMARY";

export type LedgerAsset = "TEC" | "SOLAR" | "WIND" | "RECORD";

export interface LedgerTransaction {
  id: string; // Hedera-style: 0.0.1000@seconds.nanos
  type: LedgerTxType;
  asset: LedgerAsset;
  fromAccountId: string | null; // null = created
  toAccountId: string | null; // null = destroyed
  amount: number;
  feeHbar: number;
  memo: string;
  timestamp: number;
  blockIndex: number | null;
  relatedTradeId: string | null;
}

export type PublicHousehold = Omit<Household, "passwordHash" | "hederaPrivateKeyEncrypted">;

export interface EnergyMeasurement {
  id: string;
  householdId: string;
  timestamp: number;
  production: number; // kWh
  consumption: number; // kWh
  surplus: number; // production - consumption, positive = surplus, negative = deficit
}

export type OfferStatus = "active" | "completed" | "cancelled";

export interface EnergyOffer {
  id: string;
  sellerId: string;
  amountKwh: number; // original offered amount
  amountRemainingKwh: number;
  pricePerKwh: number; // in TEC tokens
  status: OfferStatus;
  createdAt: number;
  updatedAt: number;
}

export type TradeStatus = "pending" | "completed" | "failed";

export interface EnergyTrade {
  id: string;
  offerId: string;
  sellerId: string;
  buyerId: string;
  amountKwh: number;
  pricePerKwh: number;
  totalPrice: number; // amountKwh * pricePerKwh, in TEC
  status: TradeStatus;
  ledgerTxId: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface BlockchainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  nonce: number;
  transactionIds: string[];
}

export interface Wallet {
  householdId: string;
  accountId: string;
  tokenBalance: number;
  reservedTec: number;
  availableTec: number;
  certificates: { solar: number; wind: number };
  greenShare: { solarKwh: number; windKwh: number; greyKwh: number; percentGreen: number };
  utility: { importedKwh: number; importCost: number; exportedKwh: number; exportCredit: number; net: number };
  topupsEnabled: boolean;
  topupMaxTec: number;
}

export interface LedgerStatus {
  mode: "simulated-hedera";
  operatorAccountId: string;
  blocksCount: number;
  transactionsCount: number;
  totalFeesHbar: number;
  latestBlockIndex: number | null;
}

export interface AuthTokenPayload {
  householdId: string;
  type: HouseholdType;
}
