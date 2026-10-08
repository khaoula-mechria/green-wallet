import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import type { EnergyOffer } from "../domain/types.js";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../utils/errors.js";
import { env, priceBand } from "../config/env.js";
import type { GridService } from "./gridService.js";
import type { ClockService } from "./clockService.js";

const MIN_OFFER_KWH = 0.1;

/**
 * Manual marketplace: fixed-price bilateral contracts next to the auction
 * (docs/DESIGN.md §8). "You can only sell what you own now": an offer reserves
 * kWh that stay in the seller's battery / rented storage (and out of the
 * auction) until sold, cancelled or expired. Offers shrink if the seller's own
 * deficit or storage decay uses the energy (GridService.shrinkOffers).
 */
export class MarketplaceService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;

  constructor(
    private readonly db: Database,
    private readonly grid: GridService,
    private readonly clock: ClockService
  ) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
  }

  createOffer(sellerId: string, amountKwh: number, pricePerKwh: number): EnergyOffer {
    const seller = this.households.findById(sellerId);
    if (!seller) throw new NotFoundError("Seller household");
    if (seller.type === "producer") throw new ForbiddenError("producers sell through the auction only");
    if (!Number.isFinite(amountKwh) || amountKwh < MIN_OFFER_KWH) throw new ValidationError(`amountKwh must be at least ${MIN_OFFER_KWH}`);
    const band = priceBand();
    if (!Number.isFinite(pricePerKwh) || pricePerKwh < band.floor || pricePerKwh > band.ceiling) {
      throw new ValidationError(
        `pricePerKwh must be between the floor ${band.floor.toFixed(2)} and the ceiling ${band.ceiling.toFixed(2)} TEC/kWh`
      );
    }

    const now = Date.now();
    const expiryIntervals = Math.max(1, Math.round((env.offerExpirySimHours * 60) / this.clock.minutesPerInterval()));
    const offer: EnergyOffer = {
      id: uuid(),
      sellerId,
      sellerName: seller.name,
      amountKwh,
      amountRemainingKwh: amountKwh,
      pricePerKwh,
      status: "active",
      expiresAtSimTime: this.clock.simTime() + expiryIntervals * this.clock.minutesPerInterval(),
      expiresAtInterval: this.clock.interval() + expiryIntervals,
      createdAt: now,
      updatedAt: now,
    };

    this.db.transaction(() => {
      // Re-read inside the transaction so two listings can't reserve the same kWh.
      const listable = this.grid.listable(this.households.findById(sellerId)!);
      if (amountKwh > listable + 1e-9) {
        throw new ValidationError(
          `you can list at most ${listable.toFixed(2)} kWh (stored energy + battery above your ` +
            `${seller.settings.batterySell.keepPercent}% reserve, minus kWh already listed)`
        );
      }
      this.offers.insert(offer);
    })();

    return this.getOffer(offer.id);
  }

  cancelOffer(sellerId: string, offerId: string): EnergyOffer {
    const offer = this.offers.findById(offerId);
    if (!offer) throw new NotFoundError("Offer");
    if (offer.sellerId !== sellerId) throw new ForbiddenError("only the seller can cancel this offer");
    if (offer.status !== "active") throw new ConflictError(`offer is already ${offer.status}`);

    // Nothing to give back: listed kWh never left the seller's stock.
    this.offers.updateRemainingAndStatus(offerId, 0, "cancelled", Date.now());
    return this.getOffer(offerId);
  }

  getActiveOffers(): EnergyOffer[] {
    return this.offers.findActive();
  }

  getOffer(id: string): EnergyOffer {
    const o = this.offers.findById(id);
    if (!o) throw new NotFoundError("Offer");
    return o;
  }

  getOffersBySeller(sellerId: string): EnergyOffer[] {
    return this.offers.findBySeller(sellerId);
  }
}
