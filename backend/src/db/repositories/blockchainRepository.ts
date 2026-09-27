import type { Database } from "better-sqlite3";
import type { BlockchainBlock, BlockchainTransaction } from "../../domain/types.js";

export class BlockchainRepository {
  constructor(private readonly db: Database) {}

  insertTransaction(t: BlockchainTransaction): void {
    this.db
      .prepare(
        `INSERT INTO blockchain_transactions
          (id, type, fromId, toId, amount, timestamp, blockIndex, hederaTransactionId, payload)
         VALUES (@id, @type, @fromId, @toId, @amount, @timestamp, @blockIndex, @hederaTransactionId, @payload)`
      )
      .run(t);
  }

  setTransactionBlock(id: string, blockIndex: number): void {
    this.db.prepare(`UPDATE blockchain_transactions SET blockIndex = ? WHERE id = ?`).run(blockIndex, id);
  }

  findTransactionById(id: string): BlockchainTransaction | undefined {
    return this.db
      .prepare(`SELECT * FROM blockchain_transactions WHERE id = ?`)
      .get(id) as BlockchainTransaction | undefined;
  }

  findAllTransactions(limit = 200): BlockchainTransaction[] {
    return this.db
      .prepare(`SELECT * FROM blockchain_transactions ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as BlockchainTransaction[];
  }

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
