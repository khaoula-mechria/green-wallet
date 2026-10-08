import type { Database } from "better-sqlite3";
import type {
  BlockchainService,
  ChainTransactionInput,
  ChainTransactionResult,
} from "./BlockchainService.js";
import type { BlockchainBlock } from "../domain/types.js";
import { BlockchainRepository } from "../db/repositories/blockchainRepository.js";
import { mineBlock, computeBlockHash } from "./hash.js";

const GENESIS_PREVIOUS_HASH = "0".repeat(64);

/**
 * Self-contained simulated blockchain: an append-only, hash-chained ledger
 * with no external dependencies. Each recorded transaction is immediately
 * mined into its own block (one-tx-per-block keeps the demo's cause → block
 * relationship easy to follow in the explorer UI).
 */
export class LocalBlockchainService implements BlockchainService {
  readonly mode = "local" as const;
  private readonly repo: BlockchainRepository;

  constructor(db: Database) {
    this.repo = new BlockchainRepository(db);
    this.ensureGenesisBlock();
  }

  private ensureGenesisBlock(): void {
    if (this.repo.getLatestBlock()) return;
    const base = { index: 0, timestamp: Date.now(), previousHash: GENESIS_PREVIOUS_HASH, transactionIds: [], nonce: 0 };
    const genesis: BlockchainBlock = { ...base, hash: computeBlockHash(base) };
    this.repo.insertBlock(genesis);
  }

  async recordTransaction(input: ChainTransactionInput): Promise<ChainTransactionResult> {
    // Phase 0: The ledger service handles transaction recording. This method is kept
    // for backwards compatibility but doesn't record to blockchain_transactions anymore.
    // The hash chain (blockchain_blocks) is still maintained for tamper evidence.
    const timestamp = Date.now();
    const latest = this.repo.getLatestBlock();
    const previousHash = latest?.hash ?? GENESIS_PREVIOUS_HASH;
    const index = (latest?.index ?? -1) + 1;
    const transactionIds = [input.id];

    const { hash, nonce } = mineBlock({ index, timestamp, previousHash, transactionIds });

    this.repo.insertBlock({ index, timestamp, previousHash, hash, nonce, transactionIds });

    return { blockchainTxId: input.id, blockIndex: index, blockHash: hash, hederaTransactionId: null };
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

  getStatus() {
    const blocks = this.getChain();
    return {
      mode: this.mode,
      blocksCount: blocks.length,
      details: { latestHash: blocks.at(-1)?.hash ?? GENESIS_PREVIOUS_HASH },
    };
  }
}
