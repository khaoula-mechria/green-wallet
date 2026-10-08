import { describe, it, expect } from "vitest";
import { buildTestContainer } from "../testContainer.js";
import { seedDemoData, SEED_HOUSEHOLDS } from "../../src/scripts/seedData.js";
import { householdLoad, simulateReading, solarFactor } from "../../src/simulation/curves.js";
import { GRID_STORAGE_ACCOUNT, UTILITY_ACCOUNT } from "../../src/services/ledgerService.js";

const noise = () => 0.5;

describe("Phase 1 — roles, energy profiles and the demo seed", () => {
  it("gives each role its own profile", () => {
    const solarFarm = { id: "producer-1", type: "producer" as const, energyType: "solar" };
    const windFarm = { id: "producer-2", type: "producer" as const, energyType: "wind" };
    const home = { id: "prosumer-1", type: "prosumer" as const, energyType: "solar" };
    const consumer = { id: "consumer-1", type: "consumer" as const, energyType: "grid" };

    // Solar only by day; wind also at night; plants consume nothing; consumers produce nothing.
    expect(simulateReading(solarFarm, 2, noise).production).toBe(0);
    expect(simulateReading(solarFarm, 12, noise).production).toBeGreaterThan(15);
    expect(simulateReading(windFarm, 2, noise).production).toBeGreaterThan(0);
    expect(simulateReading(solarFarm, 12, noise).consumption).toBe(0);
    expect(simulateReading(consumer, 12, noise).production).toBe(0);

    // A rooftop is much smaller than a farm; homes peak in the evening.
    expect(simulateReading(home, 12, noise).production).toBeLessThan(5);
    expect(householdLoad(20)).toBeGreaterThan(householdLoad(14));
    expect(solarFactor(12)).toBeCloseTo(1);
  });

  it("seeds 2 producers, 5 prosumers and 4 consumers, with no money created from production", async () => {
    const c = buildTestContainer();
    await seedDemoData(c, () => {});

    const all = c.households.getAll();
    const count = (type: string) => all.filter((h) => h.type === type).length;
    expect([count("producer"), count("prosumer"), count("consumer")]).toEqual([2, 5, 4]);
    expect(c.households.getById("producer-2").energyType).toBe("wind");

    // Producers earn nothing until they sell; consumers get grant + seed top-up.
    expect(c.tokens.getBalance("producer-1")).toBe(0);
    expect(c.tokens.getBalance("prosumer-1")).toBe(10);
    expect(c.tokens.getBalance("consumer-1")).toBe(50);
    // The first readings wait for the first auction: the farms offer their output,
    // battery-less prosumer 3 its 1.5 kWh surplus, consumers bid for their deficit.
    expect(c.auction.myBid("producer-1").bids).toEqual([{ source: "surplus", quantity: 12, limitPrice: 0.06 }]);
    expect(c.auction.myBid("prosumer-3").bids).toEqual([{ source: "surplus", quantity: 1.5, limitPrice: 0.05 }]);
    expect(c.auction.myBid("consumer-4").bids).toEqual([{ source: "deficit", quantity: 0.9, limitPrice: 0.15 }]);
    expect(c.ledger.getCertificates(UTILITY_ACCOUNT)).toEqual({ solar: 0, wind: 0 });

    // Batteries from §6.7 start half full; prosumer-2 then banks its 2 kWh surplus.
    expect(c.households.getById("prosumer-2")).toMatchObject({ batteryCapacityKwh: 15, batteryChargeKwh: 9.5 });
    expect(c.households.getById("prosumer-2").settings).toMatchObject({ overflowMode: "store", storeMinPrice: 0.18 });
    expect(c.households.getById("prosumer-3").batteryCapacityKwh).toBe(0);
    expect(c.grid.status().gridPool).toMatchObject({ capacityKwh: 40, chargeKwh: 20 });

    // Seeding twice is a no-op.
    await seedDemoData(c, () => {});
    expect(c.households.getAll()).toHaveLength(SEED_HOUSEHOLDS.length);
  });

  it("keeps money, energy and certificates balanced over a simulated day", async () => {
    const c = buildTestContainer();
    await seedDemoData(c, () => {});
    const households = c.households.getAll();

    for (let i = 0; i < 48; i++) await c.simulation.runInterval();

    expect(c.clock.simTime()).toBe(6 * 60 + 48 * 30); // a full day later
    const checks = c.analytics.checks();
    expect(checks.money.ok).toBe(true);
    expect(checks.energy.ok).toBe(true);
    expect(checks.certificates.ok).toBe(true);
    expect(checks.noNegative.ok).toBe(true);
    for (const h of households) {
      const held = c.tokens.wallet(h.id).certificates;
      expect(held.solar + held.wind).toBeLessThanOrEqual(c.certificates.stockKwh(h.id) + 0.011);
    }
    expect(checks.clearing).toEqual({ ok: true, balance: 0 });
    // Prosumers live partly on their own solar; consumers now buy local green energy in the auction.
    expect(c.tokens.wallet("prosumer-1").greenShare.percentGreen).toBeGreaterThan(30);
    expect(c.tokens.wallet("consumer-1").greenShare.percentGreen).toBeGreaterThan(20);
    expect(c.tokens.getBalance("producer-1")).toBeGreaterThan(0); // farms earn by selling, never by producing
    // One auction per interval, and the price follows supply and demand within the band.
    const prices = c.auction.history(48).map((p) => p.price).filter((p): p is number => p !== null);
    expect(c.auction.history(100)).toHaveLength(48);
    expect(Math.min(...prices)).toBeGreaterThanOrEqual(0.05);
    expect(Math.max(...prices)).toBeLessThanOrEqual(0.3);
    expect(Math.max(...prices)).toBeGreaterThan(Math.min(...prices));
    // The grid pool trades like a storage operator (buys cheap, sells dear) and stays within capacity.
    const pool = c.grid.status().gridPool;
    expect(pool.chargeKwh).toBeGreaterThanOrEqual(0);
    expect(pool.chargeKwh).toBeLessThanOrEqual(pool.capacityKwh);
    expect(c.ledger.getBalance(GRID_STORAGE_ACCOUNT).balance).not.toBe(500); // it bought or sold
    expect(c.analytics.getDashboard().greenShare.percentGreen).toBeGreaterThan(0);
  });
});
