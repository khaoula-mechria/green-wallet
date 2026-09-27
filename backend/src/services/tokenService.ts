import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { TokenTransactionRepository, tokenTxToDomain, type TokenTransactionRow } from "../db/repositories/tokenTransactionRepository.js";
import { atomic } from "../db/transaction.js";
import type { BlockchainService } from "../blockchain/BlockchainService.js";
import type { BlockchainTxType, TokenTransaction, TokenTransactionType } from "../domain/types.js";
import { MICRO_PER_WH_MINTED, kwhToWh, microToTec, tecToMicro } from "../domain/units.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

const LEDGER_TYPE: Record<TokenTransactionType, BlockchainTxType> = {
  GRANT: "GRANT",
  MINT: "MINT",
  TRANSFER: "TRANSFER",
  TRADE_SETTLEMENT: "TRADE",
};

/**
 * Owns every token-balance mutation in the system. Financial/token value
 * (TEC) is tracked here strictly separately from physical energy quantity
 * (kWh) — except for MINT, which tokenizes surplus energy 1:1.
 *
 * Every mutation writes, in ONE database transaction: the balance change, the
 * token_transactions record, and the ledger block. Debits are conditional
 * SQL updates, so a balance can never be overdrawn — even by concurrent
 * requests — and a crash can never leave a balance without its ledger record.
 *
 * The `*InTx` methods are the building blocks other services compose into
 * larger atomic operations (a trade settles tokens and energy together); they
 * must be called inside `atomic(...)`.
 */
export class TokenService {
  private readonly households: HouseholdRepository;
  private readonly tokenTx: TokenTransactionRepository;

  constructor(private readonly db: Database, private readonly blockchain: BlockchainService) {
    this.households = new HouseholdRepository(db);
    this.tokenTx = new TokenTransactionRepository(db);
  }

  // --- in-transaction building blocks (sync) --------------------------------

  /** Issues new TEC (GRANT or MINT). For MINT, `energyWh` is the tokenized
   * surplus credited to the household's sellable energy balance. */
  issueInTx(type: "GRANT" | "MINT", householdId: string, amountMicro: number, payload: Record<string, unknown>, energyWh = 0): TokenTransaction {
    if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) throw new ValidationError("issued amount must be positive");
    if (!this.households.exists(householdId)) throw new NotFoundError("Household");

    const now = Date.now();
    const id = uuid();
    const chain = this.blockchain.append({ id, type: LEDGER_TYPE[type], fromId: null, toId: householdId, amountMicro, payload });
    this.households.creditTokens(householdId, amountMicro, now);
    if (energyWh > 0) this.households.creditEnergy(householdId, energyWh, now);
    return this.record({ id, type, fromHouseholdId: null, toHouseholdId: householdId, amountMicro, timestamp: now, blockchainTxId: chain.blockchainTxId, relatedTradeId: null });
  }

  transferInTx(
    fromId: string,
    toId: string,
    amountMicro: number,
    relatedTradeId: string | null,
    type: "TRANSFER" | "TRADE_SETTLEMENT"
  ): TokenTransaction {
    if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) throw new ValidationError("transfer amount must be positive");
    const sender = this.households.findById(fromId);
    if (!sender) throw new NotFoundError("Sender household");
    if (!this.households.exists(toId)) throw new NotFoundError("Receiver household");
    if (fromId === toId) throw new ValidationError("cannot transfer to the same household");

    const now = Date.now();
    if (!this.households.debitTokens(fromId, amountMicro, now)) {
      throw new ValidationError(
        `insufficient token balance: has ${sender.tokenBalance.toFixed(2)} TEC, needs ${microToTec(amountMicro).toFixed(2)} TEC`
      );
    }
    this.households.creditTokens(toId, amountMicro, now);

    const id = uuid();
    const chain = this.blockchain.append({ id, type: LEDGER_TYPE[type], fromId, toId, amountMicro, payload: { relatedTradeId } });
    return this.record({ id, type, fromHouseholdId: fromId, toHouseholdId: toId, amountMicro, timestamp: now, blockchainTxId: chain.blockchainTxId, relatedTradeId });
  }

  private record(row: TokenTransactionRow): TokenTransaction {
    this.tokenTx.insert(row);
    return tokenTxToDomain(row);
  }

  // --- public API (decimal TEC / kWh) ----------------------------------------

  /** Issues TEC by policy (signup grant, seed data). */
  async grant(householdId: string, amountTec: number, reason: string): Promise<TokenTransaction> {
    return atomic(this.db, () => this.issueInTx("GRANT", householdId, tecToMicro(amountTec), { reason }));
  }

  /** Mints TEC 1:1 against tokenized energy (kWh) and credits that energy as sellable. */
  async mint(householdId: string, amountKwh: number): Promise<TokenTransaction> {
    const wh = kwhToWh(amountKwh);
    if (wh <= 0) throw new ValidationError("mint amount must be positive");
    return atomic(this.db, () => this.issueInTx("MINT", householdId, wh * MICRO_PER_WH_MINTED, { reason: "energy-surplus-tokenization" }, wh));
  }

  /** Atomic TEC transfer between two households (does not move energy kWh). */
  async transfer(
    fromId: string,
    toId: string,
    amount: number,
    relatedTradeId: string | null = null,
    type: "TRANSFER" | "TRADE_SETTLEMENT" = "TRANSFER"
  ): Promise<TokenTransaction> {
    const micro = tecToMicro(amount);
    if (micro <= 0) throw new ValidationError("transfer amount must be positive");
    return atomic(this.db, () => this.transferInTx(fromId, toId, micro, relatedTradeId, type));
  }

  getBalance(householdId: string): number {
    const h = this.households.findById(householdId);
    if (!h) throw new NotFoundError("Household");
    return h.tokenBalance;
  }

  getHistory(householdId: string): TokenTransaction[] {
    if (!this.households.exists(householdId)) throw new NotFoundError("Household");
    return this.tokenTx.findByHousehold(householdId);
  }

  getAllHistory(): TokenTransaction[] {
    return this.tokenTx.findAll();
  }
}
