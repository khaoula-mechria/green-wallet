import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import { TradeRepository } from "../db/repositories/tradeRepository.js";
import type { EnergyTrade } from "../domain/types.js";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors.js";
import type { TokenService } from "./tokenService.js";

/**
 * Automated trade execution — the "smart contract" of this MVP: business
 * rules (enough surplus reserved, enough buyer balance, offer still active)
 * are checked in code and enforced atomically against the database, exactly
 * the way a real smart contract would enforce them on-chain. See
 * BlockchainService for the swap-in point if this logic ever moves into an
 * actual Hedera Smart Contract.
 *
 * Two-phase by design (create -> execute), mirroring the reference
 * architecture this builds on:
 *   1. createTrade  reserves the offer's kWh capacity immediately (atomic,
 *      re-checked inside the DB transaction) and records a 'pending' trade.
 *   2. executeTrade performs the token settlement + blockchain recording,
 *      and refuses to run twice for the same trade (status must be
 *      'pending') — this is the duplicate-execution / double-spend guard.
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

  createTrade(buyerId: string, offerId: string, amountKwh: number): EnergyTrade {
    if (amountKwh <= 0) throw new ValidationError("amountKwh must be positive");

    const buyer = this.households.findById(buyerId);
    if (!buyer) throw new NotFoundError("Buyer household");

    const offer = this.offers.findById(offerId);
    if (!offer) throw new NotFoundError("Offer");
    if (offer.sellerId === buyerId) throw new ValidationError("a household cannot buy its own offer");

    const totalPrice = Number((amountKwh * offer.pricePerKwh).toFixed(4));
    const now = Date.now();
    const tradeId = uuid();

    const run = this.db.transaction(() => {
      const freshOffer = this.offers.findByIdForUpdate(offerId)!;
      if (freshOffer.status !== "active") {
        throw new ConflictError(`offer is not active (status: ${freshOffer.status})`);
      }
      if (freshOffer.amountRemainingKwh < amountKwh) {
        throw new ValidationError(
          `offer only has ${freshOffer.amountRemainingKwh.toFixed(2)} kWh remaining, requested ${amountKwh.toFixed(2)} kWh`
        );
      }

      const remaining = Number((freshOffer.amountRemainingKwh - amountKwh).toFixed(4));
      this.offers.updateRemainingAndStatus(offerId, remaining, remaining <= 0 ? "completed" : "active", now);

      this.trades.insert({
        id: tradeId,
        offerId,
        sellerId: offer.sellerId,
        buyerId,
        amountKwh,
        pricePerKwh: offer.pricePerKwh,
        totalPrice,
        status: "pending",
        ledgerTxId: null,
        createdAt: now,
        completedAt: null,
      });
    });
    run();

    return this.trades.findById(tradeId)!;
  }

  async executeTrade(tradeId: string): Promise<EnergyTrade> {
    const trade = this.trades.findById(tradeId);
    if (!trade) throw new NotFoundError("Trade");
    if (trade.status !== "pending") {
      throw new ConflictError(`trade ${tradeId} was already ${trade.status} — refusing duplicate execution`);
    }

    try {
      const settlement = await this.tokenService.transfer(
        trade.buyerId,
        trade.sellerId,
        Number((trade.totalPrice).toFixed(2)), // Round to cents
        trade.id,
        "TRADE_SETTLEMENT"
      );

      const now = Date.now();
      const run = this.db.transaction(() => {
        // Energy balance represents kWh in the buyer's possession after trade.
        this.households.adjustEnergyBalance(trade.buyerId, trade.amountKwh, now);
        this.trades.complete(trade.id, "completed", settlement.id, now);
      });
      run();

      return this.trades.findById(trade.id)!;
    } catch (err) {
      this.releaseAndFail(trade.id, trade.offerId, trade.amountKwh);
      throw err;
    }
  }

  /** Purchase = create + execute in one call, matching the single
   * `/market/offers/{id}/purchase` endpoint the API exposes. */
  async purchase(buyerId: string, offerId: string, amountKwh: number): Promise<EnergyTrade> {
    const trade = this.createTrade(buyerId, offerId, amountKwh);
    return this.executeTrade(trade.id);
  }

  private releaseAndFail(tradeId: string, offerId: string, amountKwh: number): void {
    const now = Date.now();
    const run = this.db.transaction(() => {
      const offer = this.offers.findById(offerId)!;
      const restored = Number((offer.amountRemainingKwh + amountKwh).toFixed(4));
      this.offers.updateRemainingAndStatus(offerId, restored, "active", now);
      this.trades.complete(tradeId, "failed", null, now);
    });
    run();
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
