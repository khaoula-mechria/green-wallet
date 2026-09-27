import type { Database } from "better-sqlite3";
import {
  Client,
  PrivateKey,
  AccountId,
  AccountCreateTransaction,
  TokenAssociateTransaction,
  TokenMintTransaction,
  TransferTransaction,
  Hbar,
} from "@hashgraph/sdk";
import type {
  AnchorReport,
  BlockchainService,
  BlockchainStatus,
  ChainTransactionInput,
  ChainTransactionResult,
  ChainVerification,
} from "./BlockchainService.js";
import type { BlockchainBlock } from "../domain/types.js";
import { env } from "../config/env.js";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { BlockchainRepository, type BlockchainTransactionRow } from "../db/repositories/blockchainRepository.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { LocalBlockchainService } from "./LocalBlockchainService.js";

const ANCHOR_BATCH_SIZE = 50;

/**
 * Real Hedera Hashgraph testnet integration. Only instantiated when
 * HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY / HEDERA_TOKEN_ID are all set.
 *
 * Settlement is recorded synchronously in the local hash-chained ledger (the
 * system of record, committed atomically with the balance change) and queued
 * as `pending`; `anchorPending` then replays queued entries onto Hedera in
 * ledger order. A Hedera outage therefore delays anchoring but never fails or
 * half-applies a trade.
 *
 * The TEC token must use 6 decimals (see scripts/initToken.ts), so on-chain
 * smallest units are exactly the app's µTEC.
 */
export class HederaBlockchainService implements BlockchainService {
  readonly mode = "hedera" as const;
  private readonly householdRepo: HouseholdRepository;
  private readonly repo: BlockchainRepository;
  private readonly local: LocalBlockchainService;
  private anchoring = false;

  constructor(db: Database) {
    this.householdRepo = new HouseholdRepository(db);
    this.repo = new BlockchainRepository(db);
    this.local = new LocalBlockchainService(db, "pending");
  }

  private client(): Client {
    const client = Client.forTestnet();
    client.setOperator(AccountId.fromString(env.hederaOperatorId), PrivateKey.fromStringECDSA(env.hederaOperatorKey));
    return client;
  }

  async provisionAccount(householdId: string): Promise<{ accountId: string; encryptedPrivateKey: string }> {
    void householdId;
    const client = this.client();
    try {
      const newKey = PrivateKey.generateED25519();
      const createTx = await new AccountCreateTransaction()
        .setKey(newKey.publicKey)
        .setInitialBalance(new Hbar(10))
        .execute(client);
      const receipt = await createTx.getReceipt(client);
      const accountId = receipt.accountId!.toString();

      const associateTx = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([env.hederaTokenId])
        .freezeWith(client)
        .sign(newKey);
      await (await associateTx.execute(client)).getReceipt(client);

      const encryptedPrivateKey = encryptSecret(newKey.toStringRaw());
      return { accountId, encryptedPrivateKey };
    } finally {
      client.close();
    }
  }

  append(input: ChainTransactionInput): ChainTransactionResult {
    return this.local.append(input);
  }

  async anchorPending(): Promise<AnchorReport> {
    const report: AnchorReport = { attempted: 0, anchored: 0, failed: 0 };
    if (this.anchoring) return report; // single-flight
    this.anchoring = true;
    try {
      for (const tx of this.repo.findPendingAnchors(ANCHOR_BATCH_SIZE)) {
        report.attempted += 1;
        try {
          const outcome = await this.anchorOne(tx);
          if (outcome.anchored) {
            this.repo.markAnchored(tx.id, outcome.hederaTransactionId);
            report.anchored += 1;
          } else {
            this.repo.markNotAnchorable(tx.id, outcome.reason);
          }
        } catch (err) {
          report.failed += 1;
          const status = this.repo.recordAnchorFailure(tx.id, (err as Error).message, env.ledgerAnchorMaxAttempts);
          console.error(`[hedera] anchoring ${tx.id} failed (${status}): ${(err as Error).message}`);
          // Stop this pass so later entries (which may depend on this one,
          // e.g. a transfer of freshly minted TEC) keep their order. A
          // permanently failed entry no longer blocks the queue.
          if (status === "pending") break;
        }
      }
    } finally {
      this.anchoring = false;
    }
    return report;
  }

  private async anchorOne(
    tx: BlockchainTransactionRow
  ): Promise<{ anchored: true; hederaTransactionId: string } | { anchored: false; reason: string }> {
    if (tx.type === "MINT" || tx.type === "GRANT") {
      // Issue into the treasury, then deliver to the household's account.
      const to = this.householdRepo.findById(tx.toId);
      if (!to?.hederaAccountId) return { anchored: false, reason: "recipient has no Hedera account" };
      const mintId = await this.mintToTreasury(tx.amountMicro);
      const transferId = await this.transfer(env.hederaOperatorId, null, to.hederaAccountId, tx.amountMicro);
      return { anchored: true, hederaTransactionId: `${mintId},${transferId}` };
    }

    const from = tx.fromId ? this.householdRepo.findById(tx.fromId) : undefined;
    const to = this.householdRepo.findById(tx.toId);
    if (!from?.hederaAccountId || !from.hederaPrivateKeyEncrypted || !to?.hederaAccountId) {
      return { anchored: false, reason: "a party has no Hedera account" };
    }
    const id = await this.transfer(
      from.hederaAccountId,
      PrivateKey.fromStringED25519(decryptSecret(from.hederaPrivateKeyEncrypted)),
      to.hederaAccountId,
      tx.amountMicro
    );
    return { anchored: true, hederaTransactionId: id };
  }

  private async mintToTreasury(amountMicro: number): Promise<string> {
    const client = this.client();
    try {
      const tx = await new TokenMintTransaction().setTokenId(env.hederaTokenId).setAmount(amountMicro).execute(client);
      const receipt = await tx.getReceipt(client);
      return `${tx.transactionId.toString()}:${receipt.status.toString()}`;
    } finally {
      client.close();
    }
  }

  /** `fromKey` null = the operator (treasury) account, signed by the client. */
  private async transfer(fromAccountId: string, fromKey: PrivateKey | null, toAccountId: string, amountMicro: number): Promise<string> {
    const client = this.client();
    try {
      let tx = new TransferTransaction()
        .addTokenTransfer(env.hederaTokenId, fromAccountId, -amountMicro)
        .addTokenTransfer(env.hederaTokenId, toAccountId, amountMicro)
        .freezeWith(client);
      if (fromKey) tx = await tx.sign(fromKey);
      const submitted = await tx.execute(client);
      const receipt = await submitted.getReceipt(client);
      return `${submitted.transactionId.toString()}:${receipt.status.toString()}`;
    } finally {
      client.close();
    }
  }

  getChain(): BlockchainBlock[] {
    return this.local.getChain();
  }

  getBlock(index: number): BlockchainBlock | undefined {
    return this.local.getBlock(index);
  }

  getStatus(): BlockchainStatus {
    return {
      ...this.local.getStatus(),
      mode: this.mode,
      details: { tokenId: env.hederaTokenId, operatorId: env.hederaOperatorId },
    };
  }

  verifyChain(): ChainVerification {
    return this.local.verifyChain();
  }
}
