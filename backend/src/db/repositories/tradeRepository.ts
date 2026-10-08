import type { Database } from "better-sqlite3";
import type { CertificateAmounts, EnergyTrade, TradeStatus } from "../../domain/types.js";

type TradeRow = Omit<EnergyTrade, "certificates"> & { certSolarKwh: number; certWindKwh: number };

const SELECT = `SELECT t.*, s.name AS sellerName, b.name AS buyerName
  FROM energy_trades t JOIN households s ON s.id = t.sellerId JOIN households b ON b.id = t.buyerId`;

export class TradeRepository {
  constructor(private readonly db: Database) {}

  insert(t: EnergyTrade): void {
    const { certificates, sellerName: _s, buyerName: _b, ...rest } = t;
    this.db
      .prepare(
        `INSERT INTO energy_trades
          (id, offerId, sellerId, buyerId, amountKwh, pricePerKwh, totalPrice, status, ledgerTxId,
           certSolarKwh, certWindKwh, simTime, createdAt, completedAt)
         VALUES (@id, @offerId, @sellerId, @buyerId, @amountKwh, @pricePerKwh, @totalPrice, @status, @ledgerTxId,
           @certSolarKwh, @certWindKwh, @simTime, @createdAt, @completedAt)`
      )
      .run({ ...rest, certSolarKwh: certificates.solar, certWindKwh: certificates.wind });
  }

  findById(id: string): EnergyTrade | undefined {
    const row = this.db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as TradeRow | undefined;
    return row ? toTrade(row) : undefined;
  }

  findAll(limit = 200): EnergyTrade[] {
    return (this.db.prepare(`${SELECT} ORDER BY t.createdAt DESC, t.rowid DESC LIMIT ?`).all(limit) as TradeRow[]).map(toTrade);
  }

  findByHousehold(householdId: string): EnergyTrade[] {
    return (
      this.db
        .prepare(`${SELECT} WHERE t.sellerId = ? OR t.buyerId = ? ORDER BY t.createdAt DESC, t.rowid DESC`)
        .all(householdId, householdId) as TradeRow[]
    ).map(toTrade);
  }

  complete(id: string, status: TradeStatus, ledgerTxId: string | null, completedAt: number): void {
    this.db
      .prepare(`UPDATE energy_trades SET status = ?, ledgerTxId = ?, completedAt = ? WHERE id = ?`)
      .run(status, ledgerTxId, completedAt, id);
  }

  setCertificates(id: string, certificates: CertificateAmounts): void {
    this.db
      .prepare(`UPDATE energy_trades SET certSolarKwh = ?, certWindKwh = ? WHERE id = ?`)
      .run(certificates.solar, certificates.wind, id);
  }
}

function toTrade({ certSolarKwh, certWindKwh, ...rest }: TradeRow): EnergyTrade {
  return { ...rest, certificates: { solar: certSolarKwh, wind: certWindKwh } };
}
