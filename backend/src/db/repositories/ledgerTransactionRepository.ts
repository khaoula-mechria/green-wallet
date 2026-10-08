import type { Database } from "better-sqlite3";
import type { LedgerTransaction, LedgerAsset } from "../../domain/types.js";

export class LedgerTransactionRepository {
  constructor(private readonly db: Database) {}

  insert(tx: LedgerTransaction): void {
    this.db
      .prepare(
        `INSERT INTO ledger_transactions
          (id, type, asset, fromAccountId, toAccountId, amount, feeHbar, memo, timestamp, blockIndex, relatedTradeId)
         VALUES (@id, @type, @asset, @fromAccountId, @toAccountId, @amount, @feeHbar, @memo, @timestamp, @blockIndex, @relatedTradeId)`
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
         ORDER BY timestamp DESC LIMIT ?`
      )
      .all(accountId, accountId, limit) as LedgerTransaction[];
  }

  findAll(limit = 200): LedgerTransaction[] {
    return this.db.prepare(`SELECT * FROM ledger_transactions ORDER BY timestamp DESC LIMIT ?`).all(limit) as LedgerTransaction[];
  }

  findByAsset(asset: LedgerAsset, limit = 200): LedgerTransaction[] {
    return this.db
      .prepare(`SELECT * FROM ledger_transactions WHERE asset = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(asset, limit) as LedgerTransaction[];
  }

  setPendingBlockIndex(txIds: string[], blockIndex: number): void {
    if (txIds.length === 0) return;
    const placeholders = txIds.map(() => "?").join(",");
    this.db.prepare(`UPDATE ledger_transactions SET blockIndex = ? WHERE id IN (${placeholders})`).run(blockIndex, ...txIds);
  }

  countByType(type: string): number {
    return ((this.db.prepare(`SELECT COUNT(*) as n FROM ledger_transactions WHERE type = ?`).get(type) as { n: number }) || { n: 0 }).n;
  }

  getTotalFees(): number {
    const row = this.db.prepare(`SELECT SUM(feeHbar) as total FROM ledger_transactions`).get() as { total: number | null } | undefined;
    return row?.total ?? 0;
  }

  getLatestBlockIndex(): number | null {
    const row = this.db.prepare(`SELECT MAX(blockIndex) as maxIdx FROM ledger_transactions WHERE blockIndex IS NOT NULL`).get() as
      | { maxIdx: number | null }
      | undefined;
    return row?.maxIdx ?? null;
  }
}
