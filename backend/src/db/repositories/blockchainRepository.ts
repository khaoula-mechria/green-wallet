import type { Database } from "better-sqlite3";
import type { AnchorStatus, BlockchainBlock, BlockchainTransaction, BlockchainTxType } from "../../domain/types.js";
import { microToTec } from "../../domain/units.js";

export interface BlockchainTransactionRow {
  id: string;
  type: BlockchainTxType;
  fromId: string | null;
  toId: string;
  amountMicro: number;
  timestamp: number;
  blockIndex: number | null;
  hederaTransactionId: string | null;
  payload: string;
  anchorStatus: AnchorStatus;
  anchorAttempts: number;
  anchorError: string | null;
}

interface BlockRow {
  idx: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  nonce: number;
  transactionIds: string;
  hashVersion: 1 | 2;
}

function txToDomain(r: BlockchainTransactionRow): BlockchainTransaction {
  const { amountMicro, ...rest } = r;
  return { ...rest, amount: microToTec(amountMicro) };
}

function blockToDomain(row: BlockRow): BlockchainBlock {
  return {
    index: row.idx,
    timestamp: row.timestamp,
    previousHash: row.previousHash,
    hash: row.hash,
    nonce: row.nonce,
    transactionIds: JSON.parse(row.transactionIds),
    hashVersion: row.hashVersion,
  };
}

export class BlockchainRepository {
  constructor(private readonly db: Database) {}

  insertTransaction(t: Omit<BlockchainTransactionRow, "anchorAttempts" | "anchorError">): void {
    this.db
      .prepare(
        `INSERT INTO blockchain_transactions
          (id, type, fromId, toId, amountMicro, timestamp, blockIndex, hederaTransactionId, payload, anchorStatus)
         VALUES (@id, @type, @fromId, @toId, @amountMicro, @timestamp, @blockIndex, @hederaTransactionId, @payload, @anchorStatus)`
      )
      .run(t);
  }

  setTransactionBlock(id: string, blockIndex: number): void {
    this.db.prepare(`UPDATE blockchain_transactions SET blockIndex = ? WHERE id = ?`).run(blockIndex, id);
  }

  findTransactionRow(id: string): BlockchainTransactionRow | undefined {
    return this.db.prepare(`SELECT * FROM blockchain_transactions WHERE id = ?`).get(id) as BlockchainTransactionRow | undefined;
  }

  findTransactionById(id: string): BlockchainTransaction | undefined {
    const row = this.findTransactionRow(id);
    return row ? txToDomain(row) : undefined;
  }

  findAllTransactions(limit = 200): BlockchainTransaction[] {
    return (
      this.db.prepare(`SELECT * FROM blockchain_transactions ORDER BY timestamp DESC LIMIT ?`).all(limit) as BlockchainTransactionRow[]
    ).map(txToDomain);
  }

  insertBlock(b: BlockchainBlock): void {
    this.db
      .prepare(
        `INSERT INTO blockchain_blocks (idx, timestamp, previousHash, hash, nonce, transactionIds, hashVersion)
         VALUES (@index, @timestamp, @previousHash, @hash, @nonce, @transactionIds, @hashVersion)`
      )
      .run({ ...b, transactionIds: JSON.stringify(b.transactionIds) });
  }

  getLatestBlock(): BlockchainBlock | undefined {
    const row = this.db.prepare(`SELECT * FROM blockchain_blocks ORDER BY idx DESC LIMIT 1`).get() as BlockRow | undefined;
    return row ? blockToDomain(row) : undefined;
  }

  getAllBlocks(): BlockchainBlock[] {
    return (this.db.prepare(`SELECT * FROM blockchain_blocks ORDER BY idx ASC`).all() as BlockRow[]).map(blockToDomain);
  }

  countBlocks(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM blockchain_blocks`).get() as { n: number }).n;
  }

  getBlockByIndex(index: number): BlockchainBlock | undefined {
    const row = this.db.prepare(`SELECT * FROM blockchain_blocks WHERE idx = ?`).get(index) as BlockRow | undefined;
    return row ? blockToDomain(row) : undefined;
  }

  // --- external anchoring (outbox) -----------------------------------------

  /** Oldest-first, so the external chain sees operations in ledger order. */
  findPendingAnchors(limit: number): BlockchainTransactionRow[] {
    return this.db
      .prepare(`SELECT * FROM blockchain_transactions WHERE anchorStatus = 'pending' ORDER BY blockIndex ASC LIMIT ?`)
      .all(limit) as BlockchainTransactionRow[];
  }

  markAnchored(id: string, hederaTransactionId: string | null): void {
    this.db
      .prepare(`UPDATE blockchain_transactions SET anchorStatus = 'anchored', hederaTransactionId = ?, anchorError = NULL WHERE id = ?`)
      .run(hederaTransactionId, id);
  }

  /** Not anchorable (e.g. a party has no external account): stays local-only. */
  markNotAnchorable(id: string, reason: string): void {
    this.db.prepare(`UPDATE blockchain_transactions SET anchorStatus = 'none', anchorError = ? WHERE id = ?`).run(reason, id);
  }

  /** Records a failed attempt; gives up (status `failed`) after `maxAttempts`. */
  recordAnchorFailure(id: string, error: string, maxAttempts: number): AnchorStatus {
    this.db
      .prepare(
        `UPDATE blockchain_transactions
         SET anchorAttempts = anchorAttempts + 1,
             anchorError = ?,
             anchorStatus = CASE WHEN anchorAttempts + 1 >= ? THEN 'failed' ELSE 'pending' END
         WHERE id = ?`
      )
      .run(error.slice(0, 500), maxAttempts, id);
    return (this.db.prepare(`SELECT anchorStatus FROM blockchain_transactions WHERE id = ?`).get(id) as { anchorStatus: AnchorStatus })
      .anchorStatus;
  }

  anchorCounts(): Record<AnchorStatus, number> {
    const counts: Record<AnchorStatus, number> = { none: 0, pending: 0, anchored: 0, failed: 0 };
    for (const r of this.db
      .prepare(`SELECT anchorStatus, COUNT(*) AS n FROM blockchain_transactions GROUP BY anchorStatus`)
      .all() as { anchorStatus: AnchorStatus; n: number }[]) {
      counts[r.anchorStatus] = r.n;
    }
    return counts;
  }
}
