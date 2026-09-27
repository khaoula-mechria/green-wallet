import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import { TradeRepository, type TradeRow } from "../db/repositories/tradeRepository.js";
import { atomic } from "../db/transaction.js";
import type { EnergyTrade } from "../domain/types.js";
import { kwhToWh, tradeTotalMicro, whToKwh } from "../domain/units.js";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors.js";
import type { TokenService } from "./tokenService.js";

export interface PurchaseResult {
  trade: EnergyTrade;
  /** true when an earlier purchase with the same idempotency key was returned. */
  replayed: boolean;
}

/**
 * Automated trade execution — the "smart contract" of this MVP: business
 * rules (enough offer capacity, enough buyer balance, offer still active)
 * are checked in code and enforced atomically against the database, exactly
 * the way a real smart contract would enforce them on-chain.
 *
 * `purchase` is ONE database transaction: reserve the offer's capacity, pay
 * the seller, deliver the energy to the buyer, write the ledger block, and
 * mark the trade completed. Any failure (e.g. insufficient balance) rolls all
 * of it back, so there are no half-settled trades and nothing to clean up.
 *
 * The two-phase API (createTrade -> executeTrade) is kept for callers that
 * need to reserve first; executeTrade refuses to run twice for the same trade
 * (the duplicate-execution guard), and trades left `pending` too long are
 * released by `releaseStalePending`.
 */
export class TradeService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;
  private readonly trades: TradeRepository;

  constructor(private readonly db: Database, private readonly tokenService: TokenService) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
    this.trades = new TradeRepository(db);
  }

  /** Reserves offer capacity and records a `pending` trade. Must run inside `atomic`. */
  private createTradeInTx(buyerId: string, offerId: string, amountWh: number, idempotencyKey: string | null): TradeRow {
    if (!this.households.exists(buyerId)) throw new NotFoundError("Buyer household");
    const offer = this.offers.findRow(offerId);
    if (!offer) throw new NotFoundError("Offer");
    if (offer.sellerId === buyerId) throw new ValidationError("a household cannot buy its own offer");
    if (offer.status !== "active") throw new ConflictError(`offer is not active (status: ${offer.status})`);

    const totalPriceMicro = tradeTotalMicro(offer.priceMicroPerKwh, amountWh);
    if (totalPriceMicro <= 0) throw new ValidationError("purchase amount is too small to price (total rounds to 0 TEC)");

    const now = Date.now();
    if (!this.offers.reserve(offerId, amountWh, now)) {
      throw new ValidationError(
        `offer only has ${whToKwh(offer.amountRemainingWh).toFixed(2)} kWh remaining, requested ${whToKwh(amountWh).toFixed(2)} kWh`
      );
    }

    const row: TradeRow = {
      id: uuid(),
      offerId,
      sellerId: offer.sellerId,
      buyerId,
      amountWh,
      priceMicroPerKwh: offer.priceMicroPerKwh,
      totalPriceMicro,
      status: "pending",
      blockchainTxId: null,
      idempotencyKey,
      createdAt: now,
      completedAt: null,
    };
    this.trades.insert(row);
    return row;
  }

  /** Pays the seller, delivers energy to the buyer, completes the trade.
   * Must run inside `atomic`; throws (rolling back) on insufficient balance. */
  private settleInTx(trade: TradeRow): void {
    const settlement = this.tokenService.transferInTx(trade.buyerId, trade.sellerId, trade.totalPriceMicro, trade.id, "TRADE_SETTLEMENT");
    const now = Date.now();
    this.households.creditEnergy(trade.buyerId, trade.amountWh, now);
    if (!this.trades.finish(trade.id, "completed", settlement.blockchainTxId, now)) {
      throw new ConflictError(`trade ${trade.id} is no longer pending — refusing duplicate execution`);
    }
  }

  private toAmountWh(amountKwh: number): number {
    const wh = kwhToWh(amountKwh);
    if (wh <= 0) throw new ValidationError("amountKwh must be positive (minimum 0.001 kWh)");
    return wh;
  }

  createTrade(buyerId: string, offerId: string, amountKwh: number): EnergyTrade {
    const amountWh = this.toAmountWh(amountKwh);
    const row = atomic(this.db, () => this.createTradeInTx(buyerId, offerId, amountWh, null));
    return this.trades.findById(row.id)!;
  }

  async executeTrade(tradeId: string): Promise<EnergyTrade> {
    const trade = this.trades.findRow(tradeId);
    if (!trade) throw new NotFoundError("Trade");
    if (trade.status !== "pending") {
      throw new ConflictError(`trade ${tradeId} was already ${trade.status} — refusing duplicate execution`);
    }

    try {
      atomic(this.db, () => this.settleInTx(trade));
    } catch (err) {
      // Settlement rolled back; give the reserved capacity back and close the trade.
      this.releaseAndFail(trade);
      throw err;
    }
    return this.trades.findById(trade.id)!;
  }

  /**
   * Purchase = reserve + settle in ONE atomic transaction, matching the single
   * `/market/offers/{id}/purchase` endpoint. With an idempotency key, retrying
   * the same request returns the original trade instead of buying twice.
   */
  async purchase(buyerId: string, offerId: string, amountKwh: number, idempotencyKey?: string): Promise<PurchaseResult> {
    const amountWh = this.toAmountWh(amountKwh);

    const { tradeId, replayed } = atomic(this.db, () => {
      if (idempotencyKey) {
        const previous = this.trades.findByIdempotencyKey(buyerId, idempotencyKey);
        if (previous) {
          if (previous.offerId !== offerId || previous.amountWh !== amountWh) {
            throw new ConflictError("Idempotency-Key was already used for a different purchase");
          }
          return { tradeId: previous.id, replayed: true };
        }
      }
      const trade = this.createTradeInTx(buyerId, offerId, amountWh, idempotencyKey ?? null);
      this.settleInTx(trade);
      return { tradeId: trade.id, replayed: false };
    });

    return { trade: this.trades.findById(tradeId)!, replayed };
  }

  /** Fails a pending trade and returns its reserved energy: to the offer if it
   * is still open (or sold out), or to the seller if it was cancelled since. */
  private releaseAndFail(trade: TradeRow): boolean {
    return atomic(this.db, () => {
      const now = Date.now();
      if (!this.trades.finish(trade.id, "failed", null, now)) return false; // already settled or failed
      if (!this.offers.release(trade.offerId, trade.amountWh, now)) {
        this.households.creditEnergy(trade.sellerId, trade.amountWh, now);
      }
      return true;
    });
  }

  /** Releases trades stuck in `pending` for longer than `olderThanMs` (e.g.
   * reserved but never executed). @returns how many were released. */
  releaseStalePending(olderThanMs: number): number {
    let released = 0;
    for (const trade of this.trades.findPendingCreatedBefore(Date.now() - olderThanMs)) {
      if (this.releaseAndFail(trade)) released += 1;
    }
    return released;
  }

  getById(id: string): EnergyTrade {
    const t = this.trades.findById(id);
    if (!t) throw new NotFoundError("Trade");
    return t;
  }

  getAll(): EnergyTrade[] {
    return this.trades.findAll();
  }

  getForHousehold(householdId: string): EnergyTrade[] {
    return this.trades.findByHousehold(householdId);
  }
}
