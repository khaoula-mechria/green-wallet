import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import type { EnergyOffer } from "../domain/types.js";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../utils/errors.js";

/**
 * Energy marketplace: producers/prosumers list surplus for sale as offers.
 * Creating an offer immediately escrows the offered kWh out of the seller's
 * sellable `energyBalance` (domain rule: a household cannot sell more energy
 * than its available surplus) so it can't be double-offered across multiple
 * listings; cancelling an offer returns whatever wasn't sold.
 */
export class MarketplaceService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;

  constructor(private readonly db: Database) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
  }

  createOffer(sellerId: string, amountKwh: number, pricePerKwh: number): EnergyOffer {
    if (amountKwh <= 0) throw new ValidationError("amountKwh must be positive");
    if (pricePerKwh <= 0) throw new ValidationError("pricePerKwh must be positive");

    const seller = this.households.findById(sellerId);
    if (!seller) throw new NotFoundError("Seller household");

    const now = Date.now();
    const offer: EnergyOffer = {
      id: uuid(),
      sellerId,
      amountKwh,
      amountRemainingKwh: amountKwh,
      pricePerKwh,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const run = this.db.transaction(() => {
      // Re-read inside the transaction to guard against a concurrent mutation
      // of the seller's balance between the check above and this write.
      const fresh = this.households.findById(sellerId)!;
      if (fresh.energyBalance < amountKwh) {
        throw new ValidationError(
          `insufficient surplus: has ${fresh.energyBalance.toFixed(2)} kWh available, offer requires ${amountKwh.toFixed(2)} kWh`
        );
      }
      this.households.adjustBalances(sellerId, -amountKwh, 0, now);
      this.offers.insert(offer);
    });
    run();

    return offer;
  }

  cancelOffer(sellerId: string, offerId: string): EnergyOffer {
    const offer = this.offers.findById(offerId);
    if (!offer) throw new NotFoundError("Offer");
    if (offer.sellerId !== sellerId) throw new ForbiddenError("only the seller can cancel this offer");
    if (offer.status !== "active") throw new ConflictError(`offer is already ${offer.status}`);

    const now = Date.now();
    const run = this.db.transaction(() => {
      this.households.adjustBalances(sellerId, offer.amountRemainingKwh, 0, now);
      this.offers.updateRemainingAndStatus(offerId, 0, "cancelled", now);
    });
    run();

    return { ...offer, amountRemainingKwh: 0, status: "cancelled", updatedAt: now };
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
