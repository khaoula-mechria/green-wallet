import type { Database } from "better-sqlite3";
import type {
  AnchorReport,
  BlockchainService,
  BlockchainStatus,
  ChainTransactionInput,
  ChainTransactionResult,
  ChainVerification,
} from "./BlockchainService.js";
import type { AnchorStatus, BlockchainBlock } from "../domain/types.js";
import { BlockchainRepository, type BlockchainTransactionRow } from "../db/repositories/blockchainRepository.js";
import { computeBlockHash, mineBlock, POW_DIFFICULTY, transactionsDigest } from "./hash.js";

const GENESIS_PREVIOUS_HASH = "0".repeat(64);

/**
 * Self-contained simulated blockchain: an append-only, hash-chained ledger
 * with no external dependencies. Each recorded transaction is immediately
 * mined into its own block (one-tx-per-block keeps the demo's cause → block
 * relationship easy to follow in the explorer UI). Block hashes commit to the
 * transactions' full contents, so editing any recorded amount is detectable.
 */
export class LocalBlockchainService implements BlockchainService {
  readonly mode = "local" as const;
  private readonly repo: BlockchainRepository;

  /** @param newTxAnchorStatus initial anchoring state for appended entries —
   * `pending` when an external chain (Hedera) will pick them up. */
  constructor(private readonly db: Database, private readonly newTxAnchorStatus: AnchorStatus = "none") {
    this.repo = new BlockchainRepository(db);
    this.ensureGenesisBlock();
  }

  private ensureGenesisBlock(): void {
    if (this.repo.getLatestBlock()) return;
    const header = { index: 0, timestamp: Date.now(), previousHash: GENESIS_PREVIOUS_HASH, transactionIds: [], nonce: 0 };
    const genesis: BlockchainBlock = { ...header, hashVersion: 2, hash: computeBlockHash({ ...header, hashVersion: 2 }, transactionsDigest([])) };
    this.repo.insertBlock(genesis);
  }

  append(input: ChainTransactionInput): ChainTransactionResult {
    // Savepoint when called inside the caller's transaction (the intended
    // use); its own atomic transaction if called standalone.
    return this.db.transaction(() => {
      const row: Omit<BlockchainTransactionRow, "anchorAttempts" | "anchorError"> = {
        id: input.id,
        type: input.type,
        fromId: input.fromId,
        toId: input.toId,
        amountMicro: input.amountMicro,
        timestamp: Date.now(),
        blockIndex: null,
        hederaTransactionId: null,
        payload: JSON.stringify(input.payload),
        anchorStatus: this.newTxAnchorStatus,
      };
      this.repo.insertTransaction(row);

      const latest = this.repo.getLatestBlock();
      const header = {
        index: (latest?.index ?? -1) + 1,
        timestamp: row.timestamp,
        previousHash: latest?.hash ?? GENESIS_PREVIOUS_HASH,
        transactionIds: [row.id],
      };
      const { hash, nonce } = mineBlock(header, transactionsDigest([row]));

      this.repo.insertBlock({ ...header, hash, nonce, hashVersion: 2 });
      this.repo.setTransactionBlock(row.id, header.index);

      return { blockchainTxId: row.id, blockIndex: header.index, blockHash: hash };
    }).immediate();
  }

  async anchorPending(): Promise<AnchorReport> {
    // Nothing external to anchor to in local mode.
    return { attempted: 0, anchored: 0, failed: 0 };
  }

  async provisionAccount(): Promise<{ accountId: null; encryptedPrivateKey: null }> {
    // No ledger-level identity needed in local/simulated mode.
    return { accountId: null, encryptedPrivateKey: null };
  }

  getChain(): BlockchainBlock[] {
    return this.repo.getAllBlocks();
  }

  getBlock(index: number): BlockchainBlock | undefined {
    return this.repo.getBlockByIndex(index);
  }

  getStatus(): BlockchainStatus {
    const latest = this.repo.getLatestBlock();
    return {
      mode: this.mode,
      blocksCount: this.repo.countBlocks(),
      anchoring: this.repo.anchorCounts(),
      details: { latestHash: latest?.hash ?? GENESIS_PREVIOUS_HASH },
    };
  }

  verifyChain(): ChainVerification {
    const blocks = this.repo.getAllBlocks();
    const errors: ChainVerification["errors"] = [];
    const prefix = "0".repeat(POW_DIFFICULTY);
    let legacyBlocks = 0;

    blocks.forEach((block, i) => {
      const fail = (reason: string) => errors.push({ blockIndex: block.index, reason });

      if (block.index !== i) fail(`expected index ${i}`);
      const expectedPrev = i === 0 ? GENESIS_PREVIOUS_HASH : blocks[i - 1].hash;
      if (block.previousHash !== expectedPrev) fail("previousHash does not match the preceding block's hash");
      if (i > 0 && !block.hash.startsWith(prefix)) fail("hash does not satisfy the proof-of-work difficulty");

      if (block.hashVersion === 1) {
        legacyBlocks += 1;
        if (computeBlockHash(block) !== block.hash) fail("hash does not match block contents");
        return;
      }

      const transactions = block.transactionIds.map((id) => this.repo.findTransactionRow(id));
      const missing = block.transactionIds.filter((_, k) => !transactions[k]);
      if (missing.length > 0) return fail(`missing transaction(s): ${missing.join(", ")}`);
      const rows = transactions as BlockchainTransactionRow[];
      for (const tx of rows) {
        if (tx.blockIndex !== block.index) fail(`transaction ${tx.id} claims block ${tx.blockIndex}`);
      }
      if (computeBlockHash(block, transactionsDigest(rows)) !== block.hash) {
        fail("hash does not match block contents (a transaction was altered)");
      }
    });

    return { valid: errors.length === 0, blocksChecked: blocks.length, legacyBlocks, errors };
  }
}
