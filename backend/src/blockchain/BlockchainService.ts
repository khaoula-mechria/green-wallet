import type { AnchorStatus, BlockchainBlock, BlockchainTxType } from "../domain/types.js";

export interface ChainTransactionInput {
  id: string;
  type: BlockchainTxType;
  fromId: string | null;
  toId: string;
  amountMicro: number;
  payload: Record<string, unknown>;
}

export interface ChainTransactionResult {
  blockchainTxId: string;
  blockIndex: number;
  blockHash: string;
}

export type BlockchainMode = "local" | "hedera";

export interface AnchorReport {
  attempted: number;
  anchored: number;
  failed: number;
}

export interface ChainVerification {
  valid: boolean;
  blocksChecked: number;
  /** Legacy blocks whose hash only commits to transaction ids, not contents. */
  legacyBlocks: number;
  errors: { blockIndex: number; reason: string }[];
}

export interface BlockchainStatus {
  mode: BlockchainMode;
  blocksCount: number;
  anchoring: Record<AnchorStatus, number>;
  details: Record<string, unknown>;
}

/**
 * Abstraction boundary between the application and whatever ledger records
 * transactions. Two phases, so a money movement and its ledger record can
 * never disagree:
 *
 *  1. `append` — synchronous. Writes the transaction into the local
 *     hash-chained ledger. It MUST be called inside the same database
 *     transaction as the balance change it records: both commit, or neither.
 *  2. `anchorPending` — asynchronous, retryable. Pushes appended entries to an
 *     external chain (Hedera), outside any database transaction (an outbox).
 *     A no-op in local mode. Failures never roll back a committed settlement;
 *     they're retried, and after too many attempts flagged `failed` for
 *     operator reconciliation.
 */
export interface BlockchainService {
  readonly mode: BlockchainMode;

  append(input: ChainTransactionInput): ChainTransactionResult;

  anchorPending(): Promise<AnchorReport>;

  /** Ensures a household has a ledger identity (only meaningful for `hedera`). */
  provisionAccount(householdId: string): Promise<{ accountId: string | null; encryptedPrivateKey: string | null }>;

  getChain(): BlockchainBlock[];
  getBlock(index: number): BlockchainBlock | undefined;
  getStatus(): BlockchainStatus;
  /** Recomputes every block hash (and its transactions' contents) and checks the chain links. */
  verifyChain(): ChainVerification;
}
