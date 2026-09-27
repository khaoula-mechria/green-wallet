import type { Database } from "better-sqlite3";
import type { BlockchainService } from "./BlockchainService.js";
import { LocalBlockchainService } from "./LocalBlockchainService.js";
import { HederaBlockchainService } from "./HederaBlockchainService.js";
import { isHederaConfigured } from "../config/env.js";

export function createBlockchainService(db: Database): BlockchainService {
  if (isHederaConfigured) {
    return new HederaBlockchainService(db);
  }
  return new LocalBlockchainService(db);
}

export type {
  BlockchainService,
  ChainTransactionInput,
  ChainTransactionResult,
  AnchorReport,
  ChainVerification,
} from "./BlockchainService.js";
