import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { LedgerService } from "./ledgerService.js";
import type { LedgerTransaction, Wallet } from "../domain/types.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { greenShareOf } from "./certificateService.js";

/**
 * Household-facing façade over LedgerService for TEC: transfers, balances,
 * history, simulated top-up / cash-out and the wallet summary.
 *
 * There is no minting: production earns certificates, and TEC only enters
 * through the treasury (grants, top-ups) and moves when energy is sold
 * (docs/DESIGN.md §2, §7).
 */
export class TokenService {
  private readonly households: HouseholdRepository;
  private topupCooldowns: Map<string, number> = new Map(); // accountId -> lastTopupMs

  constructor(private readonly db: Database, private readonly ledger: LedgerService) {
    this.households = new HouseholdRepository(db);
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
  getHistory(householdId: string, limit = 100): LedgerTransaction[] {
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");
    const account = this.ledger.getHouseholdAccount(householdId);
    return this.ledger.getHistory(account.id, limit);
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
      certificates: this.ledger.getCertificates(account.id),
      greenShare: greenShareOf([household]),
      utility: {
        importedKwh: round2(household.importedKwh),
        importCost: round2(household.importCost),
        exportedKwh: round2(household.exportedKwh),
        exportCredit: round2(household.exportCredit),
        net: round2(household.exportCredit - household.importCost),
      },
      topupsEnabled: env.topupsEnabled,
      topupMaxTec: env.topupMaxTec,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
