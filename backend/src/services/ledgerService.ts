import type { Database } from "better-sqlite3";
import { AccountRepository } from "../db/repositories/accountRepository.js";
import { LedgerTransactionRepository } from "../db/repositories/ledgerTransactionRepository.js";
import { BlockchainRepository } from "../db/repositories/blockchainRepository.js";
import type {
  Account,
  CertificateAmounts,
  CertificateAsset,
  LedgerTransaction,
  LedgerTx,
  LedgerTxType,
  LedgerAsset,
  LedgerStatus,
} from "../domain/types.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { mineBlock } from "../blockchain/hash.js";

export const OPERATOR_ACCOUNT = "0.0.1000";
export const TREASURY_ACCOUNT = "0.0.1001";
export const CLEARING_ACCOUNT = "0.0.1002";
export const GRID_STORAGE_ACCOUNT = "0.0.1003";
/** The main utility grid: receives the certificates of exported energy (DESIGN.md §2.3). Never holds TEC. */
export const UTILITY_ACCOUNT = "0.0.1004";

const FIRST_HOUSEHOLD_ACCOUNT = 4801;
const TOKEN_IDS = { TEC: "0.0.5001", SOLAR: "0.0.5002", WIND: "0.0.5003" };
const GENESIS_PREVIOUS_HASH = "0".repeat(64);

export type LedgerHistoryFilter = "ALL" | "TEC" | "CERT" | "RECORD";

/**
 * Core ledger service: account balances, TEC transfers, green certificates and
 * transaction recording. Every movement is atomic, gets a Hedera-style ID and a
 * simulated fee, and is sealed into its own hash-chained block.
 *
 * TEC and certificates follow the same rules: a null `from` creates (TEC top-up,
 * certificate issue), a null `to` destroys (cash-out, certificate retirement).
 */
export class LedgerService {
  private readonly accounts: AccountRepository;
  private readonly ledger: LedgerTransactionRepository;
  private readonly blocks: BlockchainRepository;
  private txSequence: number;

  constructor(
    private readonly db: Database,
    private readonly clock: { simTime(): number } = { simTime: () => 0 }
  ) {
    this.accounts = new AccountRepository(db);
    this.ledger = new LedgerTransactionRepository(db);
    this.blocks = new BlockchainRepository(db);
    // Continue the sequence across restarts so IDs minted in the same second never collide.
    this.txSequence = this.ledger.count();
  }

  /** Creates the operator accounts and funds treasury and grid storage. Idempotent. */
  bootstrap(): void {
    if (this.accounts.findById(OPERATOR_ACCOUNT)) return;

    const run = this.db.transaction(() => {
      const now = Date.now();
      const operatorAccounts: Array<Pick<Account, "id" | "kind" | "label">> = [
        { id: OPERATOR_ACCOUNT, kind: "household", label: "Operator" },
        { id: TREASURY_ACCOUNT, kind: "treasury", label: "Treasury" },
        { id: CLEARING_ACCOUNT, kind: "clearing", label: "Clearing" },
        { id: GRID_STORAGE_ACCOUNT, kind: "grid_storage", label: "Grid storage" },
        { id: UTILITY_ACCOUNT, kind: "utility", label: "Main utility grid" },
      ];
      for (const a of operatorAccounts) {
        this.accounts.insert({ ...a, householdId: null, balance: 0, reservedBalance: 0, solarBalance: 0, windBalance: 0, createdAt: now });
      }

      if (env.treasuryInitialTec > 0) {
        this.transfer("OPERATOR_FUNDING", null, TREASURY_ACCOUNT, env.treasuryInitialTec, "Initial TEC supply (token creation)");
      }
      if (env.gridStorageInitialTec > 0) {
        this.transfer(
          "OPERATOR_FUNDING",
          TREASURY_ACCOUNT,
          GRID_STORAGE_ACCOUNT,
          env.gridStorageInitialTec,
          "Grid storage trading account funding"
        );
      }
    });
    run();
  }

  createHouseholdAccount(householdId: string, label: string): Account {
    const account: Account = {
      id: `0.0.${this.nextHouseholdAccountNumber()}`,
      kind: "household",
      householdId,
      label,
      balance: 0,
      reservedBalance: 0,
      solarBalance: 0,
      windBalance: 0,
      createdAt: Date.now(),
    };
    this.accounts.insert(account);
    return account;
  }

  /**
   * Atomically moves TEC. A null `from` creates supply, a null `to` destroys it.
   * The sender's available balance (balance - reserved) must cover the amount.
   */
  transfer(
    type: LedgerTxType,
    fromAccountId: string | null,
    toAccountId: string | null,
    amount: number,
    memo: string = "",
    relatedTradeId: string | null = null
  ): LedgerTransaction {
    const a = round2(amount);
    if (!(a > 0)) throw new ValidationError("transfer amount must be positive");

    const run = this.db.transaction(() => {
      if (fromAccountId !== null) {
        const from = this.accounts.findById(fromAccountId);
        if (!from) throw new NotFoundError("From account");
        const available = from.balance - from.reservedBalance;
        if (available < a - 1e-6) {
          throw new ValidationError(
            `insufficient balance: ${from.label} has ${available.toFixed(2)} TEC available, needs ${a.toFixed(2)} TEC`
          );
        }
        this.accounts.updateBalance(fromAccountId, -a);
      }

      if (toAccountId !== null) {
        if (!this.accounts.findById(toAccountId)) throw new NotFoundError("To account");
        this.accounts.updateBalance(toAccountId, a);
      }

      return this.recordTx(type, "TEC", fromAccountId, toAccountId, a, memo, relatedTradeId);
    });

    return run();
  }

  /** Issues certificates for energy produced by the account's owner (DESIGN.md §2.2). */
  issueCertificate(accountId: string, asset: CertificateAsset, kwh: number, memo: string): LedgerTransaction | null {
    return this.moveCertificate("CERT_ISSUE", asset, null, accountId, kwh, memo, null);
  }

  /** Moves certificates along with sold energy. */
  transferCertificate(
    fromAccountId: string,
    toAccountId: string,
    asset: CertificateAsset,
    kwh: number,
    memo: string,
    relatedTradeId: string | null = null
  ): LedgerTransaction | null {
    return this.moveCertificate("CERT_TRANSFER", asset, fromAccountId, toAccountId, kwh, memo, relatedTradeId);
  }

  /** Retires certificates when their energy is consumed, so they can't be claimed twice. */
  retireCertificate(accountId: string, asset: CertificateAsset, kwh: number, memo: string): LedgerTransaction | null {
    return this.moveCertificate("CERT_RETIRE", asset, accountId, null, kwh, memo, null);
  }

  getCertificates(accountId: string): CertificateAmounts {
    const account = this.accounts.findById(accountId);
    if (!account) throw new NotFoundError("Account");
    return { solar: round2(account.solarBalance), wind: round2(account.windBalance) };
  }

  getBalance(accountId: string): { balance: number; reserved: number; available: number } {
    const account = this.accounts.findById(accountId);
    if (!account) throw new NotFoundError("Account");
    return {
      balance: round2(account.balance),
      reserved: round2(account.reservedBalance),
      available: round2(account.balance - account.reservedBalance),
    };
  }

  getHouseholdAccount(householdId: string): Account {
    const account = this.accounts.findByHouseholdId(householdId);
    if (!account) throw new NotFoundError("Household account");
    return account;
  }

  /** Transactions touching an account, most recent first. */
  getHistory(accountId: string, limit = 100): LedgerTransaction[] {
    return this.ledger.findByAccountId(accountId, limit);
  }

  /** All transactions for the public feed, most recent first. */
  getAllHistory(limit = 200, filter: LedgerHistoryFilter = "ALL"): LedgerTransaction[] {
    switch (filter) {
      case "ALL":
        return this.ledger.findAll(limit);
      case "CERT":
        return this.ledger.findByAssets(["SOLAR", "WIND"], limit);
      default:
        return this.ledger.findByAsset(filter, limit);
    }
  }

  /** Maps stored transactions to the API contract (labels and owning household ids). */
  toLedgerTxs(txs: LedgerTransaction[]): LedgerTx[] {
    const byId = new Map(this.accounts.findAll().map((a) => [a.id, a]));
    const labelOf = (id: string) => byId.get(id)?.label ?? id;

    return txs.map((tx) => ({
      id: tx.id,
      type: tx.type,
      asset: tx.asset,
      fromAccountId: tx.fromAccountId,
      toAccountId: tx.toAccountId,
      fromLabel: tx.fromAccountId === null ? (tx.asset === "TEC" ? "Created" : "Issued") : labelOf(tx.fromAccountId),
      toLabel:
        tx.toAccountId === null
          ? tx.asset === "TEC"
            ? "Destroyed"
            : tx.asset === "RECORD"
              ? "Ledger record"
              : "Retired"
          : labelOf(tx.toAccountId),
      amount: tx.amount,
      timestamp: tx.timestamp,
      simTime: tx.simTime,
      feeHbar: tx.feeHbar,
      memo: tx.memo,
      blockIndex: tx.blockIndex,
      householdIds: [tx.fromAccountId, tx.toAccountId]
        .map((id) => (id ? byId.get(id)?.householdId : null))
        .filter((h): h is string => Boolean(h)),
    }));
  }

  /** Σ account balances must equal TEC created minus TEC destroyed. */
  checkMoneyInvariant(): { ok: boolean; totalSupply: number; sumOfBalances: number } {
    const sumOfBalances = round2(this.accounts.sumBalances());
    const { created, destroyed } = this.ledger.createdAndDestroyed("TEC");
    const totalSupply = round2(created - destroyed);
    return { ok: Math.abs(totalSupply - sumOfBalances) < 0.005, totalSupply, sumOfBalances };
  }

  /** DESIGN.md §9.4: certificates issued = held + retired (+ handed to the utility, Phase 2). */
  checkCertificateInvariant(): { ok: boolean; issued: number; accounted: number } {
    let issued = 0;
    let accounted = 0;
    for (const asset of ["SOLAR", "WIND"] as const) {
      const { created, destroyed } = this.ledger.createdAndDestroyed(asset);
      issued += created;
      accounted += this.accounts.sumCertificateBalances(asset) + destroyed;
    }
    return { ok: Math.abs(issued - accounted) < 0.005, issued: round2(issued), accounted: round2(accounted) };
  }

  treasuryBalance(): number {
    const treasury = this.accounts.findById(TREASURY_ACCOUNT);
    if (!treasury) throw new NotFoundError("Treasury account");
    return round2(treasury.balance);
  }

  getStatus(): LedgerStatus {
    const latest = this.blocks.getLatestBlock();
    return {
      mode: "simulated-hedera",
      network: "testnet (simulated)",
      operatorAccountId: OPERATOR_ACCOUNT,
      tokenIds: { ...TOKEN_IDS },
      blocksCount: this.blocks.count(),
      transactionsCount: this.ledger.count(),
      totalFeesHbar: Math.round(this.ledger.getTotalFees() * 10_000) / 10_000,
      latestHash: latest?.hash ?? "",
    };
  }

  private moveCertificate(
    type: LedgerTxType,
    asset: CertificateAsset,
    fromAccountId: string | null,
    toAccountId: string | null,
    kwh: number,
    memo: string,
    relatedTradeId: string | null
  ): LedgerTransaction | null {
    const a = round2(kwh);
    if (!Number.isFinite(a) || a < 0) throw new ValidationError("certificate amount must be a non-negative number");
    if (a === 0) return null; // below the 0.01 kWh ledger resolution

    const run = this.db.transaction(() => {
      if (fromAccountId !== null) {
        const held = this.getCertificates(fromAccountId)[asset === "SOLAR" ? "solar" : "wind"];
        if (held < a - 1e-9) {
          throw new ValidationError(`insufficient ${asset} certificates: has ${held.toFixed(2)} kWh, needs ${a.toFixed(2)} kWh`);
        }
        this.accounts.updateCertificateBalance(fromAccountId, asset, -a);
      }
      if (toAccountId !== null) {
        if (!this.accounts.findById(toAccountId)) throw new NotFoundError("To account");
        this.accounts.updateCertificateBalance(toAccountId, asset, a);
      }
      return this.recordTx(type, asset, fromAccountId, toAccountId, a, memo, relatedTradeId);
    });
    return run();
  }

  private nextHouseholdAccountNumber(): number {
    let max = FIRST_HOUSEHOLD_ACCOUNT - 1;
    for (const a of this.accounts.findByKind("household")) {
      const n = Number(a.id.split(".")[2]);
      if (n > max) max = n;
    }
    return max + 1;
  }

  /** Records a transaction and seals it into its own block. Caller must hold a DB transaction. */
  private recordTx(
    type: LedgerTxType,
    asset: LedgerAsset,
    from: string | null,
    to: string | null,
    amount: number,
    memo: string,
    relatedTradeId: string | null
  ): LedgerTransaction {
    const now = Date.now();
    this.txSequence += 1;
    const id = `${OPERATOR_ACCOUNT}@${Math.floor(now / 1000)}.${String(this.txSequence).padStart(9, "0")}`;

    const simTime = this.clock.simTime();
    const latest = this.blocks.getLatestBlock();
    const block = {
      index: (latest?.index ?? -1) + 1,
      timestamp: now,
      previousHash: latest?.hash ?? GENESIS_PREVIOUS_HASH,
      transactionIds: [id],
    };
    this.blocks.insertBlock({ ...block, ...mineBlock(block), simTime });

    const tx: LedgerTransaction = {
      id,
      type,
      asset,
      fromAccountId: from,
      toAccountId: to,
      amount: round2(amount),
      feeHbar: env.simulatedFeeHbar,
      memo,
      timestamp: now,
      simTime,
      blockIndex: block.index,
      relatedTradeId,
    };
    this.ledger.insert(tx);
    return tx;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
