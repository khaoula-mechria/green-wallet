import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { TokenTransactionRepository } from "../db/repositories/tokenTransactionRepository.js";
import type { BlockchainService } from "../blockchain/BlockchainService.js";
import type { TokenTransaction } from "../domain/types.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

/**
 * Owns every token-balance mutation in the system. Financial/token value
 * (TEC) is tracked here strictly separately from physical energy quantity
 * (kWh, owned by MeasurementService/HouseholdRepository.energyBalance) —
 * this service never interprets kWh, only TEC amounts it's told to move.
 */
export class TokenService {
  private readonly households: HouseholdRepository;
  private readonly tokenTx: TokenTransactionRepository;

  constructor(private readonly db: Database, private readonly blockchain: BlockchainService) {
    this.households = new HouseholdRepository(db);
    this.tokenTx = new TokenTransactionRepository(db);
  }

  /** Mints TEC 1:1 against reported/tokenized energy (kWh) for a household. */
  async mint(householdId: string, amountKwh: number): Promise<TokenTransaction> {
    if (amountKwh <= 0) throw new ValidationError("mint amount must be positive");
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");

    const txId = uuid();
    const chainResult = await this.blockchain.recordTransaction({
      id: txId,
      type: "MINT",
      fromId: null,
      toId: householdId,
      amount: amountKwh,
      payload: { reason: "energy-surplus-tokenization" },
    });

    const now = Date.now();
    const record: TokenTransaction = {
      id: txId,
      type: "MINT",
      fromHouseholdId: null,
      toHouseholdId: householdId,
      amount: amountKwh,
      timestamp: now,
      blockchainTxId: chainResult.blockchainTxId,
      relatedTradeId: null,
    };

    const run = this.db.transaction(() => {
      this.households.adjustBalances(householdId, amountKwh, amountKwh, now);
      this.tokenTx.insert(record);
    });
    run();

    return record;
  }

  /** Atomic TEC transfer between two households (does not move energy kWh). */
  async transfer(
    fromId: string,
    toId: string,
    amount: number,
    relatedTradeId: string | null = null,
    type: "TRANSFER" | "TRADE_SETTLEMENT" = "TRANSFER"
  ): Promise<TokenTransaction> {
    if (amount <= 0) throw new ValidationError("transfer amount must be positive");
    const sender = this.households.findById(fromId);
    const receiver = this.households.findById(toId);
    if (!sender) throw new NotFoundError("Sender household");
    if (!receiver) throw new NotFoundError("Receiver household");
    if (sender.tokenBalance < amount) {
      throw new ValidationError(
        `insufficient token balance: has ${sender.tokenBalance.toFixed(2)} TEC, needs ${amount.toFixed(2)} TEC`
      );
    }

    const txId = uuid();
    const chainResult = await this.blockchain.recordTransaction({
      id: txId,
      type: type === "TRADE_SETTLEMENT" ? "TRADE" : "TRANSFER",
      fromId,
      toId,
      amount,
      payload: { relatedTradeId },
    });

    const now = Date.now();
    const record: TokenTransaction = {
      id: txId,
      type,
      fromHouseholdId: fromId,
      toHouseholdId: toId,
      amount,
      timestamp: now,
      blockchainTxId: chainResult.blockchainTxId,
      relatedTradeId,
    };

    const run = this.db.transaction(() => {
      this.households.adjustBalances(fromId, 0, -amount, now);
      this.households.adjustBalances(toId, 0, amount, now);
      this.tokenTx.insert(record);
    });
    run();

    return record;
  }

  getBalance(householdId: string): number {
    const h = this.households.findById(householdId);
    if (!h) throw new NotFoundError("Household");
    return h.tokenBalance;
  }

  getHistory(householdId: string): TokenTransaction[] {
    if (!this.households.findById(householdId)) throw new NotFoundError("Household");
    return this.tokenTx.findByHousehold(householdId);
  }

  getAllHistory(): TokenTransaction[] {
    return this.tokenTx.findAll();
  }
}
