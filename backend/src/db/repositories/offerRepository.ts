import type { Database } from "better-sqlite3";
import type { EnergyOffer, OfferStatus } from "../../domain/types.js";

const SELECT = `SELECT o.*, h.name AS sellerName FROM energy_offers o JOIN households h ON h.id = o.sellerId`;

export class OfferRepository {
  constructor(private readonly db: Database) {}

  insert(o: EnergyOffer): void {
    const { sellerName: _name, ...row } = o;
    this.db
      .prepare(
        `INSERT INTO energy_offers
          (id, sellerId, amountKwh, amountRemainingKwh, pricePerKwh, status, expiresAtSimTime, expiresAtInterval, createdAt, updatedAt)
         VALUES (@id, @sellerId, @amountKwh, @amountRemainingKwh, @pricePerKwh, @status, @expiresAtSimTime, @expiresAtInterval, @createdAt, @updatedAt)`
      )
      .run(row);
  }

  findById(id: string): EnergyOffer | undefined {
    return this.db.prepare(`${SELECT} WHERE o.id = ?`).get(id) as EnergyOffer | undefined;
  }

  /** better-sqlite3 is synchronous and single-connection, so a read-then-write
   * inside one transaction() call is inherently serialized — no SELECT ... FOR UPDATE needed. */
  findByIdForUpdate(id: string): EnergyOffer | undefined {
    return this.findById(id);
  }

  findActive(): EnergyOffer[] {
    return this.db.prepare(`${SELECT} WHERE o.status = 'active' ORDER BY o.createdAt DESC`).all() as EnergyOffer[];
  }

  findBySeller(sellerId: string): EnergyOffer[] {
    return this.db.prepare(`${SELECT} WHERE o.sellerId = ? ORDER BY o.createdAt DESC, o.rowid DESC`).all(sellerId) as EnergyOffer[];
  }

  /** kWh a seller still has listed: reserved in its battery / storage, not for the auction. */
  sumActiveRemainingBySeller(sellerId: string): number {
    return (
      this.db
        .prepare(`SELECT COALESCE(SUM(amountRemainingKwh), 0) AS total FROM energy_offers WHERE sellerId = ? AND status = 'active'`)
        .get(sellerId) as { total: number }
    ).total;
  }

  updateRemainingAndStatus(id: string, amountRemainingKwh: number, status: OfferStatus, updatedAt: number): void {
    this.db
      .prepare(`UPDATE energy_offers SET amountRemainingKwh = ?, status = ?, updatedAt = ? WHERE id = ?`)
      .run(amountRemainingKwh, status, updatedAt, id);
  }

  /** Expires every active offer whose validity ended (DESIGN.md §8.3). Returns how many. */
  expireDue(interval: number, updatedAt: number): number {
    return this.db
      .prepare(`UPDATE energy_offers SET status = 'expired', updatedAt = ? WHERE status = 'active' AND expiresAtInterval <= ?`)
      .run(updatedAt, interval).changes;
  }
}
