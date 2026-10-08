import { describe, it, expect } from "vitest";
import { buildTestContainer } from "../testContainer.js";
import { seedDemoData, SEED_HOUSEHOLDS } from "../../src/scripts/seedData.js";
import { householdLoad, simulateReading, solarFactor } from "../../src/simulation/curves.js";
import { UTILITY_ACCOUNT } from "../../src/services/ledgerService.js";

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
    // Producers export everything until the Phase 3 auction; certificates go to the utility.
    // So do battery-less prosumers 3 and 5 (1.5 + 0.9 kWh): 12 + 2.4 SOLAR, 4 WIND.
    expect(c.tokens.wallet("producer-1").utility).toMatchObject({ exportedKwh: 12, exportCredit: 0.6 });
    expect(c.tokens.wallet("prosumer-3").utility).toMatchObject({ exportedKwh: 1.5 });
    expect(c.ledger.getCertificates(UTILITY_ACCOUNT)).toEqual({ solar: 14.4, wind: 4 });

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
    // Prosumers live partly on their own solar; consumers import (no auction until Phase 3).
    expect(c.tokens.wallet("prosumer-1").greenShare.percentGreen).toBeGreaterThan(30);
    expect(c.tokens.wallet("consumer-1").greenShare.percentGreen).toBe(0);
    expect(c.tokens.wallet("consumer-1").utility.importedKwh).toBeGreaterThan(10);
    // Store-mode prosumers park midday overflow in the shared battery; its decay feeds the grid pool.
    expect(c.grid.status().gridPool.chargeKwh).toBeGreaterThan(20);
    expect(c.analytics.getDashboard().greenShare.percentGreen).toBeGreaterThan(0);
  });
});
