import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("MarketplaceService — energy offers", () => {
  it("creates an offer and escrows the offered kWh out of the seller's surplus", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(producer.id, 8, 3); // surplus 5

    const offer = c.marketplace.createOffer(producer.id, 3, 0.2);

    expect(offer.status).toBe("active");
    expect(offer.amountRemainingKwh).toBe(3);

    const seller = c.households.getById(producer.id);
    expect(seller.energyBalance).toBe(2); // 5 - 3 escrowed
  });

  it("rejects creating an offer larger than the seller's available surplus", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(producer.id, 8, 3); // surplus 5

    expect(() => c.marketplace.createOffer(producer.id, 10, 0.2)).toThrow(/insufficient surplus/i);
  });

  it("rejects an offer with zero or negative amount/price", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(producer.id, 8, 3);

    expect(() => c.marketplace.createOffer(producer.id, 0, 0.2)).toThrow();
    expect(() => c.marketplace.createOffer(producer.id, 1, 0)).toThrow();
  });

  it("cancelling an active offer refunds the remaining escrowed energy", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(producer.id, 8, 3); // surplus 5

    const offer = c.marketplace.createOffer(producer.id, 3, 0.2);
    c.marketplace.cancelOffer(producer.id, offer.id);

    const seller = c.households.getById(producer.id);
    expect(seller.energyBalance).toBe(5); // fully refunded

    expect(() => c.marketplace.cancelOffer(producer.id, offer.id)).toThrow(/already cancelled/i);
  });

  it("only the seller may cancel their offer", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" });
    const other = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(producer.id, 8, 3);

    const offer = c.marketplace.createOffer(producer.id, 3, 0.2);
    expect(() => c.marketplace.cancelOffer(other.id, offer.id)).toThrow();
  });
});
