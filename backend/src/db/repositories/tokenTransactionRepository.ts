import type { Database } from "better-sqlite3";
import type { TokenTransaction, TokenTransactionType } from "../../domain/types.js";
import { microToTec } from "../../domain/units.js";

export interface TokenTransactionRow {
  id: string;
  type: TokenTransactionType;
  fromHouseholdId: string | null;
  toHouseholdId: string;
  amountMicro: number;
  timestamp: number;
  blockchainTxId: string | null;
  relatedTradeId: string | null;
}

export function tokenTxToDomain(r: TokenTransactionRow): TokenTransaction {
  const { amountMicro, ...rest } = r;
  return { ...rest, amount: microToTec(amountMicro) };
}

export class TokenTransactionRepository {
  constructor(private readonly db: Database) {}

  insert(t: TokenTransactionRow): void {
    this.db
      .prepare(
        `INSERT INTO token_transactions
          (id, type, fromHouseholdId, toHouseholdId, amountMicro, timestamp, blockchainTxId, relatedTradeId)
         VALUES (@id, @type, @fromHouseholdId, @toHouseholdId, @amountMicro, @timestamp, @blockchainTxId, @relatedTradeId)`
      )
      .run(t);
  }

  findByHousehold(householdId: string): TokenTransaction[] {
    return (
      this.db
        .prepare(`SELECT * FROM token_transactions WHERE fromHouseholdId = ? OR toHouseholdId = ? ORDER BY timestamp DESC`)
        .all(householdId, householdId) as TokenTransactionRow[]
    ).map(tokenTxToDomain);
  }

  findAll(limit = 200): TokenTransaction[] {
    return (
      this.db.prepare(`SELECT * FROM token_transactions ORDER BY timestamp DESC LIMIT ?`).all(limit) as TokenTransactionRow[]
    ).map(tokenTxToDomain);
  }
}
