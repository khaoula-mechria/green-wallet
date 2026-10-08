import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import { TradeRepository } from "../db/repositories/tradeRepository.js";
import type { EnergyTrade } from "../domain/types.js";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors.js";
import type { LedgerService } from "./ledgerService.js";
import type { CertificateService } from "./certificateService.js";
import type { GridService } from "./gridService.js";
import type { ClockService } from "./clockService.js";

const EPS = 1e-9;

/**
 * Marketplace purchases — bilateral contracts (docs/DESIGN.md §8.4). Business
 * rules (offer active, enough kWh, buyer can pay, buyer has room to receive) are
 * enforced atomically against the database, the way a smart contract would.
 *
 * Two-phase by design:
 *   1. createTrade reserves the offer's kWh and records a 'pending' trade.
 *   2. executeTrade settles in ONE transaction: TEC buyer → seller, kWh from the
 *      seller's rented storage first (it decays) then battery, delivered into the
 *      buyer's rented space in the shared battery, certificates with them. It
 *      refuses to run twice for the same trade (double-spend guard); on any
 *      failure nothing is settled and the reserved kWh go back to the offer.
 */
export class TradeService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;
  private readonly trades: TradeRepository;

  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly certificates: CertificateService,
    private readonly grid: GridService,
    private readonly clock: ClockService
  ) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
    this.trades = new TradeRepository(db);
  }

  createTrade(buyerId: string, offerId: string, amountKwh: number): EnergyTrade {
    if (!Number.isFinite(amountKwh) || amountKwh <= 0) throw new ValidationError("amountKwh must be positive");
    if (!this.households.findById(buyerId)) throw new NotFoundError("Buyer household");

    const offer = this.offers.findById(offerId);
    if (!offer) throw new NotFoundError("Offer");
    if (offer.sellerId === buyerId) throw new ValidationError("a household cannot buy its own offer");
    if (round2(amountKwh * offer.pricePerKwh) <= 0) throw new ValidationError("purchase too small: it must cost at least 0.01 TEC");

    const tradeId = uuid();
    const now = Date.now();

    this.db.transaction(() => {
      const fresh = this.offers.findByIdForUpdate(offerId)!;
      if (fresh.status !== "active") throw new ConflictError(`offer is not active (status: ${fresh.status})`);
      if (fresh.amountRemainingKwh < amountKwh - EPS) {
        throw new ValidationError(
          `offer only has ${fresh.amountRemainingKwh.toFixed(2)} kWh remaining, requested ${amountKwh.toFixed(2)} kWh`
        );
      }
      this.assertCanReceive(buyerId, amountKwh);

      const remaining = round4(fresh.amountRemainingKwh - amountKwh);
      this.offers.updateRemainingAndStatus(offerId, remaining, remaining <= 0 ? "completed" : "active", now);

      this.trades.insert({
        id: tradeId,
        offerId,
        sellerId: offer.sellerId,
        sellerName: offer.sellerName,
        buyerId,
        buyerName: "",
        amountKwh,
        pricePerKwh: offer.pricePerKwh,
        totalPrice: round2(amountKwh * offer.pricePerKwh),
        status: "pending",
        ledgerTxId: null,
        certificates: { solar: 0, wind: 0 },
        simTime: this.clock.simTime(),
        createdAt: now,
        completedAt: null,
      });
    })();

    return this.trades.findById(tradeId)!;
  }

  async executeTrade(tradeId: string): Promise<EnergyTrade> {
    const trade = this.trades.findById(tradeId);
    if (!trade) throw new NotFoundError("Trade");
    if (trade.status !== "pending") {
      throw new ConflictError(`trade ${tradeId} was already ${trade.status} — refusing duplicate execution`);
    }

    try {
      this.db.transaction(() => {
        const seller = this.households.findById(trade.sellerId)!;
        if (seller.batteryKwh + seller.storedKwh < trade.amountKwh - EPS) {
          throw new ConflictError("the seller no longer has this energy");
        }
        this.assertCanReceive(trade.buyerId, trade.amountKwh); // may have changed since the reservation

        const from = this.ledger.getHouseholdAccount(trade.sellerId).id;
        const to = this.ledger.getHouseholdAccount(trade.buyerId).id;
        const settlement = this.ledger.transfer(
          "TRADE_SETTLEMENT",
          to,
          from,
          trade.totalPrice,
          `Marketplace: ${trade.amountKwh.toFixed(2)} kWh at ${trade.pricePerKwh.toFixed(3)}`,
          trade.id
        );

        // Certificates follow the kWh (§2.3); computed before the seller's stock shrinks.
        const share = this.certificates.shareOf(trade.sellerId, trade.amountKwh);
        const fromStored = Math.min(trade.amountKwh, seller.storedKwh);
        const fromBattery = trade.amountKwh - fromStored;
        const now = Date.now();
        this.households.adjustStocks(trade.sellerId, -fromBattery, -fromStored, now);
        this.households.adjustStocks(trade.buyerId, 0, trade.amountKwh, now);

        const memo = `Certificates transferred with ${trade.amountKwh.toFixed(2)} kWh`;
        const solar = this.ledger.transferCertificate(from, to, "SOLAR", share.solar, memo, trade.id);
        const wind = this.ledger.transferCertificate(from, to, "WIND", share.wind, memo, trade.id);
        this.trades.setCertificates(trade.id, { solar: solar?.amount ?? 0, wind: wind?.amount ?? 0 });

        this.trades.complete(trade.id, "completed", settlement.id, now);
        this.grid.shrinkOffers(trade.sellerId);
      })();
    } catch (err) {
      this.releaseAndFail(trade.id, trade.offerId, trade.amountKwh);
      throw err;
    }

    return this.trades.findById(trade.id)!;
  }

  /** Purchase = create + execute in one call, matching `/market/offers/{id}/purchase`. */
  async purchase(buyerId: string, offerId: string, amountKwh: number): Promise<EnergyTrade> {
    const trade = this.createTrade(buyerId, offerId, amountKwh);
    return this.executeTrade(trade.id);
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

  /** Deliveries go into the buyer's rented space (§8.4), so they must fit. */
  private assertCanReceive(buyerId: string, amountKwh: number): void {
    if (this.grid.rentedFreeKwh() < 0.01) throw new ConflictError("Community storage full, marketplace deliveries paused");
    const space = this.grid.storageSpace(this.households.findById(buyerId)!);
    if (amountKwh > space + EPS) {
      throw new ValidationError(`you can receive at most ${space.toFixed(2)} kWh (deliveries go into your space in the shared battery)`);
    }
  }

  private releaseAndFail(tradeId: string, offerId: string, amountKwh: number): void {
    const now = Date.now();
    this.db.transaction(() => {
      const offer = this.offers.findById(offerId)!;
      // Give the kWh back to the offer, unless it was cancelled or expired meanwhile.
      if (offer.status === "active" || offer.status === "completed") {
        this.offers.updateRemainingAndStatus(offerId, round4(offer.amountRemainingKwh + amountKwh), "active", now);
      }
      this.trades.complete(tradeId, "failed", null, now);
    })();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
