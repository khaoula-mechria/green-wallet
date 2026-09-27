import type { Database } from "better-sqlite3";
import type { EnergyOffer, OfferStatus } from "../../domain/types.js";
import { microToTec, whToKwh } from "../../domain/units.js";

export interface OfferRow {
  id: string;
  sellerId: string;
  amountWh: number;
  amountRemainingWh: number;
  priceMicroPerKwh: number;
  status: OfferStatus;
  createdAt: number;
  updatedAt: number;
}

export function offerToDomain(r: OfferRow): EnergyOffer {
  return {
    id: r.id,
    sellerId: r.sellerId,
    amountKwh: whToKwh(r.amountWh),
    amountRemainingKwh: whToKwh(r.amountRemainingWh),
    pricePerKwh: microToTec(r.priceMicroPerKwh),
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class OfferRepository {
  constructor(private readonly db: Database) {}

  insert(o: OfferRow): void {
    this.db
      .prepare(
        `INSERT INTO energy_offers
          (id, sellerId, amountWh, amountRemainingWh, priceMicroPerKwh, status, createdAt, updatedAt)
         VALUES (@id, @sellerId, @amountWh, @amountRemainingWh, @priceMicroPerKwh, @status, @createdAt, @updatedAt)`
      )
      .run(o);
  }

  findRow(id: string): OfferRow | undefined {
    return this.db.prepare(`SELECT * FROM energy_offers WHERE id = ?`).get(id) as OfferRow | undefined;
  }

  findById(id: string): EnergyOffer | undefined {
    const row = this.findRow(id);
    return row ? offerToDomain(row) : undefined;
  }

  findActive(): EnergyOffer[] {
    return (
      this.db.prepare(`SELECT * FROM energy_offers WHERE status = 'active' ORDER BY createdAt DESC`).all() as OfferRow[]
    ).map(offerToDomain);
  }

  countActive(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM energy_offers WHERE status = 'active'`).get() as { n: number }).n;
  }

  findBySeller(sellerId: string): EnergyOffer[] {
    return (
      this.db.prepare(`SELECT * FROM energy_offers WHERE sellerId = ? ORDER BY createdAt DESC`).all(sellerId) as OfferRow[]
    ).map(offerToDomain);
  }

  /** Takes `wh` out of an active offer, closing it when it reaches zero.
   * @returns false (and changes nothing) if the offer isn't active or doesn't
   * have enough remaining. */
  reserve(id: string, wh: number, updatedAt: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE energy_offers
           SET amountRemainingWh = amountRemainingWh - @wh,
               status = CASE WHEN amountRemainingWh - @wh = 0 THEN 'completed' ELSE status END,
               updatedAt = @updatedAt
           WHERE id = @id AND status = 'active' AND amountRemainingWh >= @wh`
        )
        .run({ id, wh, updatedAt }).changes === 1
    );
  }

  /** Returns reserved capacity to an offer that is still open or was closed
   * only because it sold out (never re-opens a cancelled offer). */
  release(id: string, wh: number, updatedAt: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE energy_offers SET amountRemainingWh = amountRemainingWh + ?, status = 'active', updatedAt = ?
           WHERE id = ? AND status IN ('active', 'completed')`
        )
        .run(wh, updatedAt, id).changes === 1
    );
  }

  /** @returns false if the offer was no longer active. */
  cancel(id: string, updatedAt: number): boolean {
    return (
      this.db
        .prepare(`UPDATE energy_offers SET status = 'cancelled', amountRemainingWh = 0, updatedAt = ? WHERE id = ? AND status = 'active'`)
        .run(updatedAt, id).changes === 1
    );
  }
}
