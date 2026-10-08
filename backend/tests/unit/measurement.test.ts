import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("MeasurementService — surplus/deficit calculation", () => {
  it("certifies a producer's output; the surplus waits for the auction — no TEC is created", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" }); // no welcome grant

    const { measurement, certificateTx, retired } = await c.measurements.record(producer.id, 8, 3);

    expect(measurement.production).toBe(8);
    expect(measurement.consumption).toBe(3);
    expect(measurement.surplus).toBe(5);

    // All 8 kWh produced are certified; the 3 kWh used on the spot are retired at once.
    expect(certificateTx).not.toBeNull();
    expect(certificateTx!.type).toBe("CERT_ISSUE");
    expect(certificateTx!.asset).toBe("SOLAR");
    expect(certificateTx!.amount).toBe(8);
    expect(retired).toEqual({ solar: 3, wind: 0 });

    // A producer has no storage: its 5 kWh surplus is offered in this interval's auction,
    // still backed by its certificates. Producing earns proof, not TEC.
    expect(measurement.flow).toMatchObject({ selfUse: 3, toAuction: 5, toBattery: 0, exported: 0, settled: false });
    expect(c.tokens.wallet(producer.id).certificates).toEqual({ solar: 5, wind: 0 });
    expect(c.auction.myBid(producer.id).bids).toEqual([{ source: "surplus", quantity: 5, limitPrice: 0.05 }]);
    expect(c.tokens.getBalance(producer.id)).toBe(0);
  });

  it("sends a deficit with nothing stored to the auction, with the TEC to pay for it reserved", async () => {
    const c = buildTestContainer();
    const consumer = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant

    const { measurement, certificateTx, retired } = await c.measurements.record(consumer.id, 0, 4);

    expect(measurement.surplus).toBe(-4);
    expect(certificateTx).toBeNull();
    expect(retired).toEqual({ solar: 0, wind: 0 });

    expect(measurement.flow).toMatchObject({ toBuy: 4, imported: 0, settled: false });
    // Budget check: 4 kWh at the 0.30 buy limit = 1.20 TEC reserved until the auction settles.
    expect(c.tokens.wallet(consumer.id)).toMatchObject({ tokenBalance: 10, reservedTec: 1.2, availableTec: 8.8 });
    expect(c.auction.myBid(consumer.id).bids).toEqual([{ source: "deficit", quantity: 4, limitPrice: 0.3 }]);
    expect(c.tokens.wallet(consumer.id).greenShare.greyKwh).toBe(0); // counted once supplied

    // At the end of the interval the grid pool (pre-charged, grey) sells it at one clearing price.
    const { auction } = c.market.endInterval();
    const paid = Math.ceil(4 * auction.clearingPrice! * 100 - 1e-6) / 100;
    expect(c.tokens.wallet(consumer.id)).toMatchObject({ reservedTec: 0, tokenBalance: 10 - paid });
    expect(c.tokens.wallet(consumer.id).greenShare).toEqual({ solarKwh: 0, windKwh: 0, greyKwh: 4, percentGreen: 0 });
    expect(c.households.getHistory(consumer.id, 1)[0].flow).toMatchObject({ bought: 4, imported: 0, settled: true, price: auction.clearingPrice });
  });

  it("rejects negative production or consumption", async () => {
    const c = buildTestContainer();
    const h = await seedHousehold(c);
    await expect(c.measurements.record(h.id, -1, 2)).rejects.toThrow();
  });

  it("timestamps every measurement", async () => {
    const c = buildTestContainer();
    const h = await seedHousehold(c);
    const before = Date.now();
    const { measurement } = await c.measurements.record(h.id, 5, 1);
    expect(measurement.timestamp).toBeGreaterThanOrEqual(before);
  });
});
