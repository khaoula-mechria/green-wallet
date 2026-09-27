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

export type TokenTransactionType = "MINT" | "TRANSFER" | "TRADE_SETTLEMENT";

export interface TokenTransaction {
  id: string;
  type: TokenTransactionType;
  fromHouseholdId: string | null; // null = minted from treasury
  toHouseholdId: string;
  amount: number; // TEC
  timestamp: number;
  blockchainTxId: string | null;
  relatedTradeId: string | null;
}

export type BlockchainTxType = "MINT" | "TRANSFER" | "TRADE";

export interface BlockchainTransaction {
  id: string;
  type: BlockchainTxType;
  fromId: string | null;
  toId: string;
  amount: number;
  timestamp: number;
  blockIndex: number | null;
  hederaTransactionId: string | null; // set only when running in Hedera mode
  payload: string; // JSON-encoded details for the explorer view
}

export interface BlockchainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  nonce: number;
  transactionIds: string[];
}

export interface AuthTokenPayload {
  householdId: string;
  type: HouseholdType;
}
