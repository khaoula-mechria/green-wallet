import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository, offerToDomain, type OfferRow } from "../db/repositories/offerRepository.js";
import { atomic } from "../db/transaction.js";
import type { EnergyOffer } from "../domain/types.js";
import { kwhToWh, tecToMicro, whToKwh } from "../domain/units.js";
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
    const amountWh = kwhToWh(amountKwh, "amountKwh");
    const priceMicroPerKwh = tecToMicro(pricePerKwh, "pricePerKwh");
    if (amountWh <= 0) throw new ValidationError("amountKwh must be positive (minimum 0.001 kWh)");
    if (priceMicroPerKwh <= 0) throw new ValidationError("pricePerKwh must be positive (minimum 0.000001 TEC)");

    return atomic(this.db, () => {
      const seller = this.households.findById(sellerId);
      if (!seller) throw new NotFoundError("Seller household");

      const now = Date.now();
      if (!this.households.debitEnergy(sellerId, amountWh, now)) {
        throw new ValidationError(
          `insufficient surplus: has ${seller.energyBalance.toFixed(2)} kWh available, offer requires ${whToKwh(amountWh).toFixed(2)} kWh`
        );
      }
      const row: OfferRow = {
        id: uuid(),
        sellerId,
        amountWh,
        amountRemainingWh: amountWh,
        priceMicroPerKwh,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      this.offers.insert(row);
      return offerToDomain(row);
    });
  }

  cancelOffer(sellerId: string, offerId: string): EnergyOffer {
    return atomic(this.db, () => {
      const offer = this.offers.findRow(offerId);
      if (!offer) throw new NotFoundError("Offer");
      if (offer.sellerId !== sellerId) throw new ForbiddenError("only the seller can cancel this offer");

      const now = Date.now();
      if (!this.offers.cancel(offerId, now)) throw new ConflictError(`offer is already ${offer.status}`);
      this.households.creditEnergy(sellerId, offer.amountRemainingWh, now);

      return offerToDomain({ ...offer, amountRemainingWh: 0, status: "cancelled", updatedAt: now });
    });
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
