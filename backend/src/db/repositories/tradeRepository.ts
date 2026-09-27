import type { Database } from "better-sqlite3";
import type { EnergyTrade, TradeStatus } from "../../domain/types.js";

export class TradeRepository {
  constructor(private readonly db: Database) {}

  insert(t: EnergyTrade): void {
    this.db
      .prepare(
        `INSERT INTO energy_trades
          (id, offerId, sellerId, buyerId, amountKwh, pricePerKwh, totalPrice, status, blockchainTxId, createdAt, completedAt)
         VALUES (@id, @offerId, @sellerId, @buyerId, @amountKwh, @pricePerKwh, @totalPrice, @status, @blockchainTxId, @createdAt, @completedAt)`
      )
      .run(t);
  }

  findById(id: string): EnergyTrade | undefined {
    return this.db.prepare(`SELECT * FROM energy_trades WHERE id = ?`).get(id) as EnergyTrade | undefined;
  }

  findAll(limit = 200): EnergyTrade[] {
    return this.db.prepare(`SELECT * FROM energy_trades ORDER BY createdAt DESC LIMIT ?`).all(limit) as EnergyTrade[];
  }

  findByHousehold(householdId: string): EnergyTrade[] {
    return this.db
      .prepare(
        `SELECT * FROM energy_trades WHERE sellerId = ? OR buyerId = ? ORDER BY createdAt DESC`
      )
      .all(householdId, householdId) as EnergyTrade[];
  }

  complete(id: string, status: TradeStatus, blockchainTxId: string | null, completedAt: number): void {
    this.db
      .prepare(`UPDATE energy_trades SET status = ?, blockchainTxId = ?, completedAt = ? WHERE id = ?`)
      .run(status, blockchainTxId, completedAt, id);
  }
}
