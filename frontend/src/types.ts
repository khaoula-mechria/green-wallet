export type HouseholdType = "producer" | "consumer" | "prosumer";

export interface Household {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  hederaAccountId: string | null;
  energyType: string;
  currentProduction: number;
  currentConsumption: number;
  energyBalance: number;
  tokenBalance: number;
  createdAt: number;
  updatedAt: number;
}

export interface EnergyMeasurement {
  id: string;
  householdId: string;
  timestamp: number;
  production: number;
  consumption: number;
  surplus: number;
}

export type OfferStatus = "active" | "completed" | "cancelled";

export interface EnergyOffer {
  id: string;
  sellerId: string;
  amountKwh: number;
  amountRemainingKwh: number;
  pricePerKwh: number;
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
  totalPrice: number;
  status: TradeStatus;
  blockchainTxId: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface TokenTransaction {
  id: string;
  type: "MINT" | "TRANSFER" | "TRADE_SETTLEMENT";
  fromHouseholdId: string | null;
  toHouseholdId: string;
  amount: number;
  timestamp: number;
  blockchainTxId: string | null;
  relatedTradeId: string | null;
}

export interface BlockchainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  nonce: number;
  transactionIds: string[];
}

export interface BlockchainTransaction {
  id: string;
  type: "MINT" | "TRANSFER" | "TRADE";
  fromId: string | null;
  toId: string;
  amount: number;
  timestamp: number;
  blockIndex: number | null;
  hederaTransactionId: string | null;
  payload: string;
}

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
  recentTrades: EnergyTrade[];
  blockchain: { mode: "local" | "hedera"; blocksCount: number; details: Record<string, unknown> };
}

export interface MicrogridNode {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  production: number;
  consumption: number;
  netFlow: number;
  energyBalance: number;
}
