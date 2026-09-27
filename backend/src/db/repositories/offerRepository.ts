import type { Database } from "better-sqlite3";
import type { EnergyOffer, OfferStatus } from "../../domain/types.js";

export class OfferRepository {
  constructor(private readonly db: Database) {}

  insert(o: EnergyOffer): void {
    this.db
      .prepare(
        `INSERT INTO energy_offers
          (id, sellerId, amountKwh, amountRemainingKwh, pricePerKwh, status, createdAt, updatedAt)
         VALUES (@id, @sellerId, @amountKwh, @amountRemainingKwh, @pricePerKwh, @status, @createdAt, @updatedAt)`
      )
      .run(o);
  }

  findById(id: string): EnergyOffer | undefined {
    return this.db.prepare(`SELECT * FROM energy_offers WHERE id = ?`).get(id) as EnergyOffer | undefined;
  }

  /** Row lock semantics for the write path: better-sqlite3 is synchronous and
   * single-connection, so a read-then-write inside one transaction() call is
   * inherently serialized — no separate SELECT ... FOR UPDATE is needed. */
  findByIdForUpdate(id: string): EnergyOffer | undefined {
    return this.findById(id);
  }

  findActive(): EnergyOffer[] {
    return this.db
      .prepare(`SELECT * FROM energy_offers WHERE status = 'active' ORDER BY createdAt DESC`)
      .all() as EnergyOffer[];
  }

  findBySeller(sellerId: string): EnergyOffer[] {
    return this.db
      .prepare(`SELECT * FROM energy_offers WHERE sellerId = ? ORDER BY createdAt DESC`)
      .all(sellerId) as EnergyOffer[];
  }

  updateRemainingAndStatus(id: string, amountRemainingKwh: number, status: OfferStatus, updatedAt: number): void {
    this.db
      .prepare(`UPDATE energy_offers SET amountRemainingKwh = ?, status = ?, updatedAt = ? WHERE id = ?`)
      .run(amountRemainingKwh, status, updatedAt, id);
  }

  setStatus(id: string, status: OfferStatus, updatedAt: number): void {
    this.db.prepare(`UPDATE energy_offers SET status = ?, updatedAt = ? WHERE id = ?`).run(status, updatedAt, id);
  }
}
