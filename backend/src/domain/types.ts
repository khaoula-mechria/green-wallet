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
  tokenBalance: number; // TEC balance
  createdAt: number;
  updatedAt: number;
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
  blockchainTxId: string | null;
  createdAt: number;
  completedAt: number | null;
}

// Amounts on these API-facing types are decimal kWh / TEC. They are stored and
// computed as integers (Wh / µTEC, see domain/units.ts) and converted only at
// the repository boundary.

/** GRANT = TEC issued by policy (signup grant, seed data, opening balances);
 * MINT = TEC issued against tokenized surplus energy. */
export type TokenTransactionType = "GRANT" | "MINT" | "TRANSFER" | "TRADE_SETTLEMENT";

export interface TokenTransaction {
  id: string;
  type: TokenTransactionType;
  fromHouseholdId: string | null; // null = issued (GRANT/MINT)
  toHouseholdId: string;
  amount: number; // TEC
  timestamp: number;
  blockchainTxId: string | null;
  relatedTradeId: string | null;
}

export type BlockchainTxType = "GRANT" | "MINT" | "TRANSFER" | "TRADE";

/** External-anchoring state: `none` (local mode), `pending` (queued for the
 * external chain), `anchored` (confirmed there), `failed` (gave up after
 * retries — needs operator reconciliation). */
export type AnchorStatus = "none" | "pending" | "anchored" | "failed";

export interface BlockchainTransaction {
  id: string;
  type: BlockchainTxType;
  fromId: string | null;
  toId: string;
  amount: number; // TEC
  timestamp: number;
  blockIndex: number | null;
  hederaTransactionId: string | null; // set only when running in Hedera mode
  payload: string; // JSON-encoded details for the explorer view
  anchorStatus: AnchorStatus;
  anchorAttempts: number;
  anchorError: string | null;
}

export interface BlockchainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  nonce: number;
  transactionIds: string[];
  /** 1 = legacy hash over transaction ids only; 2 = hash also commits to
   * every transaction's contents. */
  hashVersion: 1 | 2;
}

export interface AuthTokenPayload {
  householdId: string;
  type: HouseholdType;
}
