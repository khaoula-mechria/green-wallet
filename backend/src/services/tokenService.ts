import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { LedgerService } from "./ledgerService.js";
import type { LedgerTransaction, Wallet } from "../domain/types.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { env } from "../config/env.js";

/**
 * Façade over LedgerService for token operations. Keeps the same API as before
 * (mint, transfer, getBalance, getHistory) to minimize changes in services that
 * depend on TokenService. New methods (topup, cashout, wallet) add Phase 0 features.
 *
 * All TEC movements are ledger transactions; MeasurementService and TradeService
 * route through here and ultimately call ledger.transfer.
 */
export class TokenService {
  private readonly households: HouseholdRepository;
  private topupCooldowns: Map<string, number> = new Map(); // accountId -> lastTopupMs

  constructor(private readonly db: Database, private readonly ledger: LedgerService) {
    this.households = new HouseholdRepository(db);
  }

  /** Mints TEC 1:1 against reported/tokenized energy (kWh) for a household (until P1). */
  async mint(householdId: string, amountKwh: number): Promise<LedgerTransaction> {
    if (amountKwh <= 0) throw new ValidationError("mint amount must be positive");
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");

    const account = this.ledger.getHouseholdAccount(householdId);
    return this.ledger.transfer("MINT", null, account.id, amountKwh, `Energy surplus (${amountKwh.toFixed(2)} kWh) tokenized`);
  }

  /** Atomic TEC transfer between two households (does not move energy kWh). */
  async transfer(
    fromHouseholdId: string,
    toHouseholdId: string,
    amount: number,
    relatedTradeId: string | null = null,
    type: "TRANSFER" | "TRADE_SETTLEMENT" = "TRANSFER"
  ): Promise<LedgerTransaction> {
    if (amount <= 0) throw new ValidationError("transfer amount must be positive");

    const fromHousehold = this.households.findById(fromHouseholdId);
    const toHousehold = this.households.findById(toHouseholdId);
    if (!fromHousehold) throw new NotFoundError("From household");
    if (!toHousehold) throw new NotFoundError("To household");

    const fromAccount = this.ledger.getHouseholdAccount(fromHouseholdId);
    const toAccount = this.ledger.getHouseholdAccount(toHouseholdId);

    const memo = type === "TRADE_SETTLEMENT" ? `Trade settlement (${amount.toFixed(2)} TEC)` : `Transfer (${amount.toFixed(2)} TEC)`;
    return this.ledger.transfer(type, fromAccount.id, toAccount.id, amount, memo, relatedTradeId);
  }

  /** Get TEC balance for a household. */
  getBalance(householdId: string): number {
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");
    const account = this.ledger.getHouseholdAccount(householdId);
    return account.balance;
  }

  /** Get ledger history for a household. */
  getHistory(householdId: string): LedgerTransaction[] {
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");
    const account = this.ledger.getHouseholdAccount(householdId);
    return this.ledger.getHistory(account.id);
  }

  /** Get all ledger transactions (public view, TEC only). */
  getAllHistory(): LedgerTransaction[] {
    return this.ledger.getAllHistory();
  }

  /** Top-up TEC via simulated payment (demo only, dev-mode by default, needs opt-in in prod). */
  topup(householdId: string, amount: number): Wallet {
    if (!env.topupsEnabled) throw new ValidationError("Top-ups are disabled");
    if (!Number.isFinite(amount) || amount <= 0 || amount > env.topupMaxTec) {
      throw new ValidationError(`Top-up must be between 0.01 and ${env.topupMaxTec} TEC`);
    }

    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");

    const account = this.ledger.getHouseholdAccount(householdId);
    const now = Date.now();
    const lastTopup = this.topupCooldowns.get(account.id) ?? 0;
    const wait = env.topupCooldownMs - (now - lastTopup);
    if (wait > 0) {
      throw new ValidationError(`Please wait ${Math.ceil(wait / 1000)} seconds before the next top-up`);
    }

    this.ledger.transfer("TOPUP", null, account.id, amount, `Top-up (simulated payment)`);
    this.topupCooldowns.set(account.id, now);

    return this.wallet(householdId);
  }

  /** Cash-out TEC to simulated bank account (demo only). */
  cashout(householdId: string, amount: number): Wallet {
    if (!env.topupsEnabled) throw new ValidationError("Cash-outs are disabled");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Cash-out amount must be positive");
    }

    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");

    const account = this.ledger.getHouseholdAccount(householdId);
    this.ledger.transfer("CASHOUT", account.id, null, amount, "Cash-out (simulated bank transfer)");

    return this.wallet(householdId);
  }

  /** Get wallet summary for a household (TEC balance, available, etc.). */
  wallet(householdId: string): Wallet {
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");

    const account = this.ledger.getHouseholdAccount(householdId);

    return {
      householdId,
      accountId: account.id,
      tokenBalance: account.balance,
      reservedTec: account.reservedBalance,
      availableTec: account.balance - account.reservedBalance,
      certificates: { solar: 0, wind: 0 }, // Placeholder until P1
      greenShare: { solarKwh: 0, windKwh: 0, greyKwh: 0, percentGreen: 0 }, // Placeholder until P1
      utility: { importedKwh: 0, importCost: 0, exportedKwh: 0, exportCredit: 0, net: 0 }, // Placeholder until P2
      topupsEnabled: env.topupsEnabled,
      topupMaxTec: env.topupMaxTec,
    };
  }
}
