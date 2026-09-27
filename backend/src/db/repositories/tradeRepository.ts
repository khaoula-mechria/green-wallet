import type { Database } from "better-sqlite3";
import type { EnergyTrade, TradeStatus } from "../../domain/types.js";
import { microToTec, whToKwh } from "../../domain/units.js";

export interface TradeRow {
  id: string;
  offerId: string;
  sellerId: string;
  buyerId: string;
  amountWh: number;
  priceMicroPerKwh: number;
  totalPriceMicro: number;
  status: TradeStatus;
  blockchainTxId: string | null;
  idempotencyKey: string | null;
  createdAt: number;
  completedAt: number | null;
}

function toDomain(r: TradeRow): EnergyTrade {
  return {
    id: r.id,
    offerId: r.offerId,
    sellerId: r.sellerId,
    buyerId: r.buyerId,
    amountKwh: whToKwh(r.amountWh),
    pricePerKwh: microToTec(r.priceMicroPerKwh),
    totalPrice: microToTec(r.totalPriceMicro),
    status: r.status,
    blockchainTxId: r.blockchainTxId,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  };
}

export class TradeRepository {
  constructor(private readonly db: Database) {}

  insert(t: TradeRow): void {
    this.db
      .prepare(
        `INSERT INTO energy_trades
          (id, offerId, sellerId, buyerId, amountWh, priceMicroPerKwh, totalPriceMicro, status, blockchainTxId, idempotencyKey, createdAt, completedAt)
         VALUES (@id, @offerId, @sellerId, @buyerId, @amountWh, @priceMicroPerKwh, @totalPriceMicro, @status, @blockchainTxId, @idempotencyKey, @createdAt, @completedAt)`
      )
      .run(t);
  }

  findRow(id: string): TradeRow | undefined {
    return this.db.prepare(`SELECT * FROM energy_trades WHERE id = ?`).get(id) as TradeRow | undefined;
  }

  findById(id: string): EnergyTrade | undefined {
    const row = this.findRow(id);
    return row ? toDomain(row) : undefined;
  }

  findByIdempotencyKey(buyerId: string, key: string): TradeRow | undefined {
    return this.db
      .prepare(`SELECT * FROM energy_trades WHERE buyerId = ? AND idempotencyKey = ?`)
      .get(buyerId, key) as TradeRow | undefined;
  }

  findAll(limit = 200): EnergyTrade[] {
    return (this.db.prepare(`SELECT * FROM energy_trades ORDER BY createdAt DESC LIMIT ?`).all(limit) as TradeRow[]).map(toDomain);
  }

  countCompleted(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM energy_trades WHERE status = 'completed'`).get() as { n: number }).n;
  }

  findByHousehold(householdId: string): EnergyTrade[] {
    return (
      this.db
        .prepare(`SELECT * FROM energy_trades WHERE sellerId = ? OR buyerId = ? ORDER BY createdAt DESC`)
        .all(householdId, householdId) as TradeRow[]
    ).map(toDomain);
  }

  /** Pending trades created at or before `cutoff`. */
  findPendingCreatedBefore(cutoff: number): TradeRow[] {
    return this.db
      .prepare(`SELECT * FROM energy_trades WHERE status = 'pending' AND createdAt <= ? ORDER BY createdAt`)
      .all(cutoff) as TradeRow[];
  }

  /** Moves a trade out of `pending`. @returns false if it wasn't pending —
   * the guard against settling (or failing) the same trade twice. */
  finish(id: string, status: Exclude<TradeStatus, "pending">, blockchainTxId: string | null, completedAt: number): boolean {
    return (
      this.db
        .prepare(`UPDATE energy_trades SET status = ?, blockchainTxId = ?, completedAt = ? WHERE id = ? AND status = 'pending'`)
        .run(status, blockchainTxId, completedAt, id).changes === 1
    );
  }
}
