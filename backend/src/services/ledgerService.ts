import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { AccountRepository } from "../db/repositories/accountRepository.js";
import { LedgerTransactionRepository } from "../db/repositories/ledgerTransactionRepository.js";
import type { Account, LedgerTransaction, LedgerTxType, LedgerAsset, AccountKind } from "../domain/types.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";
import { env } from "../config/env.js";

const OPERATOR_ACCOUNT = "0.0.1000";
const TREASURY_ACCOUNT = "0.0.1001";
const CLEARING_ACCOUNT = "0.0.1002";
const GRID_STORAGE_ACCOUNT = "0.0.1003";

const RESERVED_ACCOUNTS = [OPERATOR_ACCOUNT, TREASURY_ACCOUNT, CLEARING_ACCOUNT, GRID_STORAGE_ACCOUNT];

/**
 * Core ledger service: manages account balances, TEC transfers, and transaction recording.
 * All money movements flow through here. Every operation is atomic and recorded to the ledger
 * with Hedera-style IDs and fees.
 */
export class LedgerService {
  private readonly accounts: AccountRepository;
  private readonly ledger: LedgerTransactionRepository;
  private txSequence: number = 0;

  constructor(private readonly db: Database) {
    this.accounts = new AccountRepository(db);
    this.ledger = new LedgerTransactionRepository(db);
  }

  /**
   * Bootstrap: creates operator accounts and funds the treasury.
   * Idempotent — safe to call on every boot.
   */
  bootstrap(): void {
    const operatorExist = this.accounts.findById(OPERATOR_ACCOUNT);
    if (operatorExist) return;

    const run = this.db.transaction(() => {
      // Create operator identity (not funded, just exists)
      this.accounts.insert({
        id: OPERATOR_ACCOUNT,
        kind: "household",
        householdId: null,
        label: "Operator",
        balance: 0,
        reservedBalance: 0,
        createdAt: Date.now(),
      });

      // Create treasury
      this.accounts.insert({
        id: TREASURY_ACCOUNT,
        kind: "treasury",
        householdId: null,
        label: "Treasury",
        balance: env.treasuryInitialTec,
        reservedBalance: 0,
        createdAt: Date.now(),
      });

      // Create clearing
      this.accounts.insert({
        id: CLEARING_ACCOUNT,
        kind: "clearing",
        householdId: null,
        label: "Clearing",
        balance: 0,
        reservedBalance: 0,
        createdAt: Date.now(),
      });

      // Create grid storage
      this.accounts.insert({
        id: GRID_STORAGE_ACCOUNT,
        kind: "grid_storage",
        householdId: null,
        label: "Grid storage",
        balance: env.gridStorageInitialTec ?? 500,
        reservedBalance: 0,
        createdAt: Date.now(),
      });

      // Record the initial funding to the ledger
      if (env.treasuryInitialTec > 0) {
        this.recordTxUnsafe(
          "OPERATOR_FUNDING",
          "TEC",
          null,
          TREASURY_ACCOUNT,
          env.treasuryInitialTec,
          "Operator funding"
        );
      }
    });
    run();
  }

  /**
   * Create a household account with a given ID. Called from AuthService during registration.
   * Returns the new account.
   */
  createHouseholdAccount(householdId: string, label: string): Account {
    const nextNum = this.getNextAccountNumber();
    const accountId = `0.0.${nextNum}`;

    const account: Account = {
      id: accountId,
      kind: "household",
      householdId,
      label,
      balance: 0,
      reservedBalance: 0,
      createdAt: Date.now(),
    };

    this.accounts.insert(account);
    return account;
  }

  /**
   * Atomically transfer TEC from one account to another.
   * - from/to can be null: null from = created (inflation), null to = destroyed (deflation).
   * - Checks available (balance - reserved) for non-null from.
   * - Rounds to cents (2 decimals) before and after.
   * - Records a ledger transaction with Hedera-style ID and simulated fee.
   * - Never leaves negative balances or violates invariants.
   */
  transfer(
    type: LedgerTxType,
    fromAccountId: string | null,
    toAccountId: string | null,
    amount: number,
    memo: string = "",
    relatedTradeId: string | null = null
  ): LedgerTransaction {
    const a = this.round2(amount);
    if (a <= 0) throw new ValidationError("transfer amount must be positive");

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
        const to = this.accounts.findById(toAccountId);
        if (!to) throw new NotFoundError("To account");
        this.accounts.updateBalance(toAccountId, a);
      }

      return this.recordTxUnsafe(type, "TEC", fromAccountId, toAccountId, a, memo, relatedTradeId);
    });

    return run();
  }

  /**
   * Get the balance and reserved amount of an account. Raises NotFoundError if missing.
   */
  getBalance(accountId: string): { balance: number; reserved: number; available: number } {
    const account = this.accounts.findById(accountId);
    if (!account) throw new NotFoundError("Account");
    return {
      balance: this.round2(account.balance),
      reserved: this.round2(account.reservedBalance),
      available: this.round2(account.balance - account.reservedBalance),
    };
  }

  /**
   * Get the account for a household. Raises NotFoundError if missing.
   */
  getHouseholdAccount(householdId: string): Account {
    const account = this.accounts.findByHouseholdId(householdId);
    if (!account) throw new NotFoundError("Household account");
    return account;
  }

  /**
   * List ledger transactions for an account (most recent first).
   */
  getHistory(accountId: string, limit = 100): LedgerTransaction[] {
    return this.ledger.findByAccountId(accountId, limit);
  }

  /**
   * List all ledger transactions (most recent first, TEC only for now).
   */
  getAllHistory(limit = 200): LedgerTransaction[] {
    return this.ledger.findByAsset("TEC", limit);
  }

  /**
   * Money invariant check: sum of all balances should equal total supply.
   * Returns {ok, totalSupply, sumOfBalances} for diagnostics.
   */
  checkMoneyInvariant(): { ok: boolean; totalSupply: number; sumOfBalances: number } {
    const accounts = this.accounts.findAll();
    const sumOfBalances = this.round2(accounts.reduce((sum, a) => sum + a.balance, 0));

    const mintTxs = this.ledger.findByAsset("TEC");
    let totalSupply = 0;
    for (const tx of mintTxs) {
      if (tx.fromAccountId === null) totalSupply += tx.amount; // created
      if (tx.toAccountId === null) totalSupply -= tx.amount; // destroyed
    }
    totalSupply = this.round2(totalSupply);

    const ok = Math.abs(totalSupply - sumOfBalances) < 1e-6;
    return { ok, totalSupply, sumOfBalances };
  }

  /**
   * Get treasury account balance.
   */
  treasuryBalance(): number {
    const treasury = this.accounts.findById(TREASURY_ACCOUNT);
    if (!treasury) throw new NotFoundError("Treasury account");
    return this.round2(treasury.balance);
  }

  /**
   * Get operator status: ledger stats and recent transactions.
   */
  getStatus(): {
    mode: "simulated-hedera";
    operatorAccountId: string;
    blocksCount: number;
    transactionsCount: number;
    totalFeesHbar: number;
    latestBlockIndex: number | null;
  } {
    const latestBlock = this.ledger.getLatestBlockIndex();
    const txCount = this.db.prepare("SELECT COUNT(*) as n FROM ledger_transactions").get() as { n: number };
    const blockCount = this.db.prepare("SELECT COUNT(*) as n FROM blockchain_blocks").get() as { n: number };
    const fees = this.ledger.getTotalFees();

    return {
      mode: "simulated-hedera",
      operatorAccountId: OPERATOR_ACCOUNT,
      blocksCount: blockCount.n,
      transactionsCount: txCount.n,
      totalFeesHbar: this.round4(fees),
      latestBlockIndex: latestBlock,
    };
  }

  // ---- Private helpers ----

  private getNextAccountNumber(): number {
    const accounts = this.accounts.findAll();
    let maxNum = 4803; // start of household range
    for (const a of accounts) {
      const match = a.id.match(/0\.0\.(\d+)/);
      if (match) {
        const num = Number(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
    return maxNum + 1;
  }

  private recordTxUnsafe(
    type: LedgerTxType,
    asset: LedgerAsset,
    from: string | null,
    to: string | null,
    amount: number,
    memo: string,
    relatedTradeId: string | null = null
  ): LedgerTransaction {
    const now = Date.now();
    this.txSequence += 1;

    // Hedera-style ID: operator@seconds.nanos (using sequence as nanos)
    const sec = Math.floor(now / 1000);
    const nanos = String(this.txSequence).padStart(9, "0");
    const id = `${OPERATOR_ACCOUNT}@${sec}.${nanos}`;

    const tx: LedgerTransaction = {
      id,
      type,
      asset,
      fromAccountId: from,
      toAccountId: to,
      amount: this.round2(amount),
      feeHbar: env.simulatedFeeHbar,
      memo,
      timestamp: now,
      blockIndex: null,
      relatedTradeId,
    };

    this.ledger.insert(tx);
    return tx;
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private round4(n: number): number {
    return Math.round(n * 10000) / 10000;
  }
}
