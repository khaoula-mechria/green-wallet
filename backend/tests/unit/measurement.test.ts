import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("MeasurementService — surplus/deficit calculation", () => {
  it("certifies a producer's output and exports its surplus — no TEC is created", async () => {
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

    // A producer has no storage: the 5 kWh surplus is exported at the floor price, and its
    // certificates go to the utility with it. Producing earns proof, not TEC.
    expect(measurement.flow).toMatchObject({ selfUse: 3, exported: 5, toBattery: 0, settled: true });
    const wallet = c.tokens.wallet(producer.id);
    expect(wallet.certificates).toEqual({ solar: 0, wind: 0 });
    expect(wallet.utility).toEqual({ importedKwh: 0, importCost: 0, exportedKwh: 5, exportCredit: 0.25, net: 0.25 });
    expect(c.tokens.getBalance(producer.id)).toBe(0);
  });

  it("imports a deficit with nothing stored: grey energy on the utility bill, no TEC", async () => {
    const c = buildTestContainer();
    const consumer = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant

    const { measurement, certificateTx, retired } = await c.measurements.record(consumer.id, 0, 4);

    expect(measurement.surplus).toBe(-4);
    expect(certificateTx).toBeNull();
    expect(retired).toEqual({ solar: 0, wind: 0 });

    expect(measurement.flow).toMatchObject({ imported: 4 });
    expect(c.tokens.wallet(consumer.id).utility).toMatchObject({ importedKwh: 4, importCost: 1.2, net: -1.2 });
    expect(c.tokens.getBalance(consumer.id)).toBeCloseTo(10, 2); // the utility bills in real money, not TEC
    expect(c.tokens.wallet(consumer.id).greenShare).toEqual({ solarKwh: 0, windKwh: 0, greyKwh: 4, percentGreen: 0 });
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
