import type { Database } from "better-sqlite3";
import type { TokenTransaction } from "../../domain/types.js";

export class TokenTransactionRepository {
  constructor(private readonly db: Database) {}

  insert(t: TokenTransaction): void {
    this.db
      .prepare(
        `INSERT INTO token_transactions
          (id, type, fromHouseholdId, toHouseholdId, amount, timestamp, blockchainTxId, relatedTradeId)
         VALUES (@id, @type, @fromHouseholdId, @toHouseholdId, @amount, @timestamp, @blockchainTxId, @relatedTradeId)`
      )
      .run(t);
  }

  findByHousehold(householdId: string): TokenTransaction[] {
    return this.db
      .prepare(
        `SELECT * FROM token_transactions WHERE fromHouseholdId = ? OR toHouseholdId = ? ORDER BY timestamp DESC`
      )
      .all(householdId, householdId) as TokenTransaction[];
  }

  findAll(limit = 200): TokenTransaction[] {
    return this.db
      .prepare(`SELECT * FROM token_transactions ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as TokenTransaction[];
  }
}
