import type { BlockchainBlock } from "../domain/types.js";

export interface ChainTransactionInput {
  id: string;
  type: "MINT" | "TRANSFER" | "TRADE";
  fromId: string | null;
  toId: string;
  amount: number;
  payload: Record<string, unknown>;
}

export interface ChainTransactionResult {
  blockchainTxId: string;
  blockIndex: number | null;
  blockHash: string | null;
  hederaTransactionId: string | null;
}

export type BlockchainMode = "local" | "hedera";

/**
 * Abstraction boundary between the application and whatever ledger actually
 * records transactions. Swapping `local` (simulated hash-chain, zero external
 * dependencies) for `hedera` (real Hedera Hashgraph testnet) — or in the
 * future Ethereum/Polygon/Hyperledger Fabric — means implementing this one
 * interface; no other layer of the app needs to change.
 */
export interface BlockchainService {
  readonly mode: BlockchainMode;

  /** Records a transaction on the ledger. For `local`, this mines a new block
   * synchronously. For `hedera`, this performs a real on-chain token operation. */
  recordTransaction(input: ChainTransactionInput): Promise<ChainTransactionResult>;

  /** Ensures a household has a ledger identity (only meaningful for `hedera`). */
  provisionAccount(householdId: string): Promise<{ accountId: string | null; encryptedPrivateKey: string | null }>;

  getChain(): BlockchainBlock[];
  getBlock(index: number): BlockchainBlock | undefined;
  getStatus(): { mode: BlockchainMode; blocksCount: number; details: Record<string, unknown> };
}
