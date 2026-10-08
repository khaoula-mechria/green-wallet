import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("MeasurementService — surplus/deficit calculation", () => {
  it("calculates a positive surplus and auto-mints TEC 1:1 against it", async () => {
    const c = buildTestContainer();
    const producer = await seedHousehold(c, { type: "producer" }); // 0 TEC grant

    const { measurement, mintTx } = await c.measurements.record(producer.id, 8, 3);

    expect(measurement.production).toBe(8);
    expect(measurement.consumption).toBe(3);
    expect(measurement.surplus).toBe(5);

    expect(mintTx).not.toBeNull();
    expect(mintTx!.amount).toBe(5);

    const updated = c.households.getById(producer.id);
    expect(updated.energyBalance).toBe(5);
    const balance = c.tokens.getBalance(producer.id);
    expect(balance).toBeCloseTo(5, 2); // 5 TEC from MINT
  });

  it("calculates a deficit and does not mint any TEC", async () => {
    const c = buildTestContainer();
    const consumer = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant

    const { measurement, mintTx } = await c.measurements.record(consumer.id, 0, 4);

    expect(measurement.surplus).toBe(-4);
    expect(mintTx).toBeNull();

    const updated = c.households.getById(consumer.id);
    expect(updated.energyBalance).toBe(0);
    const balance = c.tokens.getBalance(consumer.id);
    expect(balance).toBeCloseTo(10, 2); // Still has welcome grant, no mint
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
