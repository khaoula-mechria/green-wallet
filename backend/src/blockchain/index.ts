import type { Database } from "better-sqlite3";
import type { BlockchainService } from "./BlockchainService.js";
import { LocalBlockchainService } from "./LocalBlockchainService.js";

/**
 * Local mode only (docs/DESIGN.md §0.4): every movement is recorded on the
 * simulated, hash-chained ledger. HederaBlockchainService is kept for a future
 * real-Hedera deployment but is not wired to the current money model, so it is
 * never selected; the server warns if HEDERA_* variables are set.
 */
export function createBlockchainService(db: Database): BlockchainService {
  return new LocalBlockchainService(db);
}

export type { BlockchainService, ChainTransactionInput, ChainTransactionResult } from "./BlockchainService.js";
