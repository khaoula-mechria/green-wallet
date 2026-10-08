import type { Database } from "better-sqlite3";
import type { LedgerTransaction, LedgerAsset } from "../../domain/types.js";

export class LedgerTransactionRepository {
  constructor(private readonly db: Database) {}

  insert(tx: LedgerTransaction): void {
    this.db
      .prepare(
        `INSERT INTO ledger_transactions
          (id, type, asset, fromAccountId, toAccountId, amount, feeHbar, memo, timestamp, simTime, blockIndex, relatedTradeId)
         VALUES (@id, @type, @asset, @fromAccountId, @toAccountId, @amount, @feeHbar, @memo, @timestamp, @simTime, @blockIndex, @relatedTradeId)`
      )
      .run(tx);
  }

  findById(id: string): LedgerTransaction | undefined {
    return this.db.prepare(`SELECT * FROM ledger_transactions WHERE id = ?`).get(id) as LedgerTransaction | undefined;
  }

  findByAccountId(accountId: string, limit = 100): LedgerTransaction[] {
    return this.db
      .prepare(
        `SELECT * FROM ledger_transactions
         WHERE fromAccountId = ? OR toAccountId = ?
         ORDER BY timestamp DESC, rowid DESC LIMIT ?`
      )
      .all(accountId, accountId, limit) as LedgerTransaction[];
  }

  findAll(limit = 200): LedgerTransaction[] {
    return this.db.prepare(`SELECT * FROM ledger_transactions ORDER BY timestamp DESC, rowid DESC LIMIT ?`).all(limit) as LedgerTransaction[];
  }

  findByAsset(asset: LedgerAsset, limit = 200): LedgerTransaction[] {
    return this.db
      .prepare(`SELECT * FROM ledger_transactions WHERE asset = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?`)
      .all(asset, limit) as LedgerTransaction[];
  }

  findByAssets(assets: LedgerAsset[], limit = 200): LedgerTransaction[] {
    const placeholders = assets.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM ledger_transactions WHERE asset IN (${placeholders}) ORDER BY timestamp DESC, rowid DESC LIMIT ?`)
      .all(...assets, limit) as LedgerTransaction[];
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) as n FROM ledger_transactions`).get() as { n: number }).n;
  }

  /** Amount of `asset` created (from = null) and destroyed (to = null) over the whole ledger.
   * For TEC that is top-ups vs cash-outs; for certificates, issued vs retired. */
  createdAndDestroyed(asset: LedgerAsset): { created: number; destroyed: number } {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN fromAccountId IS NULL THEN amount ELSE 0 END), 0) AS created,
                COALESCE(SUM(CASE WHEN toAccountId IS NULL THEN amount ELSE 0 END), 0) AS destroyed
         FROM ledger_transactions WHERE asset = ?`
      )
      .get(asset) as { created: number; destroyed: number };
  }

  getTotalFees(): number {
    const row = this.db.prepare(`SELECT SUM(feeHbar) as total FROM ledger_transactions`).get() as { total: number | null } | undefined;
    return row?.total ?? 0;
  }
}
