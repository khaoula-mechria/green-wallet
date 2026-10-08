import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold, seedSeller } from "../testContainer.js";

describe("MarketplaceService — offers reserve energy the seller owns (DESIGN.md §8)", () => {
  it("creates an offer that reserves kWh in the seller's battery without moving them", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c); // battery 5 kWh, can list 3

    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);

    expect(offer).toMatchObject({ status: "active", amountRemainingKwh: 3, sellerName: "Test Household" });
    const after = c.households.getById(seller.id);
    expect(after.batteryChargeKwh).toBe(5); // still physically in the battery
    expect(after.reservedInOffersKwh).toBe(3);
    expect(after.listableKwh).toBe(0);
  });

  it("only lets a seller list what it owns above its battery keep-reserve", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);

    expect(() => c.marketplace.createOffer(seller.id, 4, 0.2)).toThrow(/you can list at most 3\.00 kWh/);
    c.households.updateSettings(seller.id, { batterySell: { keepPercent: 0 } });
    expect(c.marketplace.createOffer(seller.id, 5, 0.2).amountKwh).toBe(5);
  });

  it("keeps prices inside the utility's band and amounts meaningful", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);

    expect(() => c.marketplace.createOffer(seller.id, 0, 0.2)).toThrow(/at least 0\.1/);
    expect(() => c.marketplace.createOffer(seller.id, 1, 0.04)).toThrow(/between the floor 0\.05 and the ceiling 0\.30/);
    expect(() => c.marketplace.createOffer(seller.id, 1, 0.31)).toThrow(/between the floor/);
  });

  it("refuses offers from producers: they sell through the auction", async () => {
    const c = buildTestContainer();
    const farm = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(farm.id, 8, 0);
    expect(() => c.marketplace.createOffer(farm.id, 1, 0.2)).toThrow(/auction only/);
  });

  it("cancelling an active offer releases the reservation", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);

    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);
    c.marketplace.cancelOffer(seller.id, offer.id);

    expect(c.households.getById(seller.id)).toMatchObject({ batteryChargeKwh: 5, reservedInOffersKwh: 0, listableKwh: 3 });
    expect(() => c.marketplace.cancelOffer(seller.id, offer.id)).toThrow(/already cancelled/i);
  });

  it("only the seller may cancel their offer", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);
    const other = await seedHousehold(c, { type: "prosumer" });

    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);
    expect(() => c.marketplace.cancelOffer(other.id, offer.id)).toThrow(/only the seller/);
  });

  it("shrinks an offer when the seller's own deficit uses the listed energy", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c); // battery 5
    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);

    await c.measurements.record(seller.id, 0, 4); // takes 4 of the 5 kWh: 1 left

    expect(c.marketplace.getOffer(offer.id)).toMatchObject({ status: "active", amountRemainingKwh: 1 });
    await c.measurements.record(seller.id, 0, 1); // nothing left
    expect(c.marketplace.getOffer(offer.id)).toMatchObject({ status: "cancelled", amountRemainingKwh: 0 });
  });

  it("expires offers after 24 simulated hours", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);
    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);
    expect(offer.expiresAtSimTime).toBe(c.clock.simTime() + 24 * 60);

    for (let i = 0; i < 47; i++) c.market.endInterval();
    expect(c.marketplace.getOffer(offer.id).status).toBe("active");
    c.market.endInterval();
    expect(c.marketplace.getOffer(offer.id).status).toBe("expired");
    expect(c.households.getById(seller.id).reservedInOffersKwh).toBe(0);
  });

  it("lists the caller's own offers in every status", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);
    const a = c.marketplace.createOffer(seller.id, 1, 0.2);
    c.marketplace.createOffer(seller.id, 1, 0.25);
    c.marketplace.cancelOffer(seller.id, a.id);

    const mine = c.marketplace.getOffersBySeller(seller.id);
    expect(mine.map((o) => o.status).sort()).toEqual(["active", "cancelled"]);
    expect(c.marketplace.getActiveOffers()).toHaveLength(1);
  });
});
