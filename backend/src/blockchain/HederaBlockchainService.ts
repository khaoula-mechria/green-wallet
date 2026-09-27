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
  BlockchainService,
  ChainTransactionInput,
  ChainTransactionResult,
} from "./BlockchainService.js";
import type { BlockchainBlock } from "../domain/types.js";
import { env } from "../config/env.js";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { LocalBlockchainService } from "./LocalBlockchainService.js";

/** TEC has 2 decimals on-chain (matches the reference token's configuration);
 * 1 kWh of tokenized energy == 1.00 TEC, i.e. amount * 100 smallest-units. */
const TEC_DECIMALS_FACTOR = 100;

/**
 * Real Hedera Hashgraph testnet integration. Only instantiated when
 * HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY / HEDERA_TOKEN_ID are all set.
 *
 * A fresh Client is opened per operation and closed in a `finally`, mirroring
 * the reference implementation's pattern — there is no long-lived shared
 * client instance.
 *
 * Every ledger-recording call also mirrors into the local hash-chained
 * ledger (via an internal LocalBlockchainService) so the in-app blockchain
 * explorer has something to render even in Hedera mode; the Hedera
 * transaction ID is what makes the record independently verifiable.
 */
export class HederaBlockchainService implements BlockchainService {
  readonly mode = "hedera" as const;
  private readonly householdRepo: HouseholdRepository;
  private readonly mirror: LocalBlockchainService;

  constructor(db: Database) {
    this.householdRepo = new HouseholdRepository(db);
    this.mirror = new LocalBlockchainService(db);
  }

  private client(): Client {
    const client = Client.forTestnet();
    client.setOperator(AccountId.fromString(env.hederaOperatorId), PrivateKey.fromStringECDSA(env.hederaOperatorKey));
    return client;
  }

  async provisionAccount(householdId: string): Promise<{ accountId: string; encryptedPrivateKey: string }> {
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

  async recordTransaction(input: ChainTransactionInput): Promise<ChainTransactionResult> {
    // Always mirror into the local chain first so the explorer has a
    // consistent, immediately-available record regardless of Hedera latency.
    const mirrored = await this.mirror.recordTransaction(input);

    let hederaTransactionId: string | null = null;

    if (input.type === "MINT") {
      hederaTransactionId = await this.mintOnChain(input.amount);
    } else {
      // TRANSFER / TRADE: move TEC from `fromId` household to `toId` household.
      if (input.fromId) {
        hederaTransactionId = await this.transferOnChain(input.fromId, input.toId, input.amount);
      }
    }

    return {
      blockchainTxId: mirrored.blockchainTxId,
      blockIndex: mirrored.blockIndex,
      blockHash: mirrored.blockHash,
      hederaTransactionId,
    };
  }

  private async mintOnChain(amountKwh: number): Promise<string> {
    const client = this.client();
    try {
      const tx = await new TokenMintTransaction()
        .setTokenId(env.hederaTokenId)
        .setAmount(Math.floor(amountKwh * TEC_DECIMALS_FACTOR))
        .execute(client);
      const receipt = await tx.getReceipt(client);
      return `${tx.transactionId.toString()}:${receipt.status.toString()}`;
    } finally {
      client.close();
    }
  }

  private async transferOnChain(fromHouseholdId: string, toHouseholdId: string, amountTec: number): Promise<string | null> {
    const from = this.householdRepo.findById(fromHouseholdId);
    const to = this.householdRepo.findById(toHouseholdId);
    if (!from?.hederaAccountId || !from.hederaPrivateKeyEncrypted || !to?.hederaAccountId) {
      // Household hasn't been provisioned with a Hedera account — settlement
      // stays local-only for this transaction (still fully recorded in the
      // local hash-chained ledger by `recordTransaction` above).
      return null;
    }

    const client = this.client();
    try {
      const fromKey = PrivateKey.fromStringED25519(decryptSecret(from.hederaPrivateKeyEncrypted));
      const amountUnits = Math.floor(amountTec * TEC_DECIMALS_FACTOR);

      const tx = await new TransferTransaction()
        .addTokenTransfer(env.hederaTokenId, from.hederaAccountId, -amountUnits)
        .addTokenTransfer(env.hederaTokenId, to.hederaAccountId, amountUnits)
        .freezeWith(client)
        .sign(fromKey);

      const submitted = await tx.execute(client);
      const receipt = await submitted.getReceipt(client);
      return `${submitted.transactionId.toString()}:${receipt.status.toString()}`;
    } finally {
      client.close();
    }
  }

  getChain(): BlockchainBlock[] {
    return this.mirror.getChain();
  }

  getBlock(index: number): BlockchainBlock | undefined {
    return this.mirror.getBlock(index);
  }

  getStatus() {
    return {
      mode: this.mode,
      blocksCount: this.mirror.getChain().length,
      details: { tokenId: env.hederaTokenId, operatorId: env.hederaOperatorId },
    };
  }
}
