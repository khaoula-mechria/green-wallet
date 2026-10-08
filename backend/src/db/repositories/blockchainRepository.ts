import type { Database } from "better-sqlite3";
import type { BlockchainBlock } from "../../domain/types.js";

export class BlockchainRepository {
  constructor(private readonly db: Database) {}

  // Note: blockchain_transactions table is deprecated (Phase 0+). Ledger transactions
  // are stored in ledger_transactions table instead. This class is kept for backwards
  // compatibility with the hash-chain blocks (blockchain_blocks table).

  insertBlock(b: BlockchainBlock): void {
    this.db
      .prepare(
        `INSERT INTO blockchain_blocks (idx, timestamp, previousHash, hash, nonce, transactionIds)
         VALUES (@index, @timestamp, @previousHash, @hash, @nonce, @transactionIds)`
      )
      .run({ ...b, transactionIds: JSON.stringify(b.transactionIds) });
  }

  private mapRow(row: { idx: number; timestamp: number; previousHash: string; hash: string; nonce: number; transactionIds: string }): BlockchainBlock {
    return {
      index: row.idx,
      timestamp: row.timestamp,
      previousHash: row.previousHash,
      hash: row.hash,
      nonce: row.nonce,
      transactionIds: JSON.parse(row.transactionIds),
    };
  }

  getLatestBlock(): BlockchainBlock | undefined {
    const row = this.db.prepare(`SELECT * FROM blockchain_blocks ORDER BY idx DESC LIMIT 1`).get() as
      | Parameters<typeof this.mapRow>[0]
      | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  getAllBlocks(): BlockchainBlock[] {
    const rows = this.db.prepare(`SELECT * FROM blockchain_blocks ORDER BY idx ASC`).all() as Parameters<
      typeof this.mapRow
    >[0][];
    return rows.map((row) => this.mapRow(row));
  }

  getBlockByIndex(index: number): BlockchainBlock | undefined {
    const row = this.db.prepare(`SELECT * FROM blockchain_blocks WHERE idx = ?`).get(index) as
      | Parameters<typeof this.mapRow>[0]
      | undefined;
    return row ? this.mapRow(row) : undefined;
  }
}
