import { describe, it, expect, afterEach } from "vitest";
import { buildTestContainer, seedHousehold, seedSeller } from "../testContainer.js";
import { env } from "../../src/config/env.js";
import { GridStorageRepository } from "../../src/db/repositories/gridStorageRepository.js";
import { UTILITY_ACCOUNT } from "../../src/services/ledgerService.js";
import type { Container } from "../../src/container.js";

const saved = { ...env };
afterEach(() => Object.assign(env, saved));

function expectAllChecks(c: Container) {
  const checks = c.analytics.checks();
  expect(checks).toMatchObject({
    money: { ok: true },
    clearing: { ok: true },
    energy: { ok: true },
    certificates: { ok: true },
    noNegative: { ok: true },
  });
}

describe("Phase 2 — batteries, the shared battery and the utility (DESIGN.md §1, §5, §6, §7.4)", () => {
  it("routes a store-mode surplus: own battery → rented storage → export", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 2, settings: { overflowMode: "store" } });

    const { measurement } = await c.measurements.record(home.id, 15, 1); // surplus 14

    expect(measurement.flow).toMatchObject({ selfUse: 1, toBattery: 2, toStorage: 10, exported: 2, imported: 0 });
    expect(c.households.getById(home.id)).toMatchObject({ batteryChargeKwh: 2, storedKwh: 10, storageSpaceKwh: 0 });
    const wallet = c.tokens.wallet(home.id);
    expect(wallet.utility).toMatchObject({ exportedKwh: 2, exportCredit: 0.1 });
    expect(wallet.certificates).toEqual({ solar: 12, wind: 0 }); // backs battery + storage
    expect(c.ledger.getCertificates(UTILITY_ACCOUNT)).toEqual({ solar: 2, wind: 0 });
    expectAllChecks(c);
  });

  it("skips rented storage in sell mode: the overflow is exported", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 2 }); // sell mode by default

    const { measurement } = await c.measurements.record(home.id, 6, 1);

    expect(measurement.flow).toMatchObject({ toBattery: 2, toStorage: 0, exported: 3 });
  });

  it("caps rented space at 10 kWh per household and 60 kWh for the community", async () => {
    const c = buildTestContainer();
    const homes = [];
    for (let i = 0; i < 7; i++) {
      homes.push(await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 0, settings: { overflowMode: "store" } }));
    }
    for (const h of homes) await c.measurements.record(h.id, 12, 0);

    const stored = homes.map((h) => c.households.getById(h.id).storedKwh);
    expect(stored).toEqual([10, 10, 10, 10, 10, 10, 0]); // the 7th finds the community battery full
    expect(c.grid.status().rented).toMatchObject({ capacityKwh: 60, usedKwh: 60, households: 6 });
    expect(c.tokens.wallet(homes[6].id).utility.exportedKwh).toBe(12);
  });

  it("covers a deficit from the battery, then stored energy, then imports at the ceiling", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 2, settings: { overflowMode: "store" } });
    await c.measurements.record(home.id, 13, 1); // battery 2, storage 10

    const { measurement } = await c.measurements.record(home.id, 0, 13);

    expect(measurement.flow).toMatchObject({ fromBattery: 2, fromStorage: 10, imported: 1 });
    const wallet = c.tokens.wallet(home.id);
    expect(wallet.utility).toMatchObject({ importedKwh: 1, importCost: 0.3 });
    expect(wallet.greenShare).toEqual({ solarKwh: 13, windKwh: 0, greyKwh: 1, percentGreen: 93 });
    expectAllChecks(c);
  });

  it("charges storage in energy: stored kWh decay 1%/h into the grid pool, certificates retired as a loss", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 0, settings: { overflowMode: "store" } });
    await c.measurements.record(home.id, 10, 0); // 10 kWh stored, 10 SOLAR

    const { decayedKwh } = c.market.endInterval(); // 30 simulated minutes

    const expectedLoss = 10 * (1 - Math.pow(0.99, 0.5));
    expect(decayedKwh).toBeCloseTo(expectedLoss, 6);
    expect(c.households.getById(home.id).storedKwh).toBeCloseTo(10 - expectedLoss, 3);
    expect(c.grid.status().gridPool.chargeKwh).toBeCloseTo(20.05, 2); // started 50% of 40 kWh
    const loss = c.ledger.toLedgerTxs(c.ledger.getAllHistory(10, "CERT")).find((t) => t.memo === "Storage losses (decay)");
    expect(loss).toMatchObject({ type: "CERT_RETIRE", amount: 0.05 });
    expect(c.clock.simTime()).toBe(6 * 60 + 30);
    expectAllChecks(c);
  });

  it("clears stored amounts that decay below 0.01 kWh", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 0, settings: { overflowMode: "store" } });
    await c.measurements.record(home.id, 1.005, 1);

    c.market.endInterval();

    expect(c.households.getById(home.id).storedKwh).toBe(0);
    expectAllChecks(c);
  });

  it("lets the operator export decayed energy the full grid pool can't take", async () => {
    const c = buildTestContainer();
    const pool = new GridStorageRepository(c.db);
    pool.adjustPool(20); // pool now full (40 kWh)…
    pool.addInitialStock(20); // …booked like the real pre-charge, or the energy check would (rightly) fail
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 0, settings: { overflowMode: "store" } });
    await c.measurements.record(home.id, 10, 0);

    c.market.endInterval();

    expect(c.grid.status().gridPool.chargeKwh).toBe(40);
    expect(c.analytics.checks().energy.ok).toBe(true); // the decayed kWh are accounted for as operator export
  });

  it("gives households default agent settings and validates changes", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer" });
    const consumer = await seedHousehold(c, { type: "consumer" });

    expect(c.households.getSettings(home.id)).toEqual({
      overflowMode: "sell",
      minSellPrice: 0.05,
      maxBuyPrice: 0.3,
      storeMinPrice: 0.175,
      batterySell: { enabled: false, minPrice: 0.25, keepPercent: 20 },
      auctionOptOut: false,
    });

    expect(c.households.updateSettings(home.id, { overflowMode: "store", batterySell: { enabled: true } })).toMatchObject({
      overflowMode: "store",
      batterySell: { enabled: true, minPrice: 0.25, keepPercent: 20 },
    });
    expect(() => c.households.updateSettings(home.id, { maxBuyPrice: 0.5 })).toThrow(/between the floor 0\.05 and the ceiling 0\.30/);
    expect(() => c.households.updateSettings(home.id, { batterySell: { keepPercent: 120 } })).toThrow(/reserve/);

    // Only prosumers choose an overflow mode or sell from a battery.
    expect(c.households.updateSettings(consumer.id, { overflowMode: "store", batterySell: { enabled: true } })).toMatchObject({
      overflowMode: "sell",
      batterySell: { enabled: false },
    });
  });

  it("gives only prosumers a home battery", async () => {
    const c = buildTestContainer();
    expect((await seedHousehold(c, { type: "prosumer" })).batteryCapacityKwh).toBe(10);
    expect((await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 0 })).batteryCapacityKwh).toBe(0);
    expect((await seedHousehold(c, { type: "consumer" })).batteryCapacityKwh).toBe(0);
    await expect(seedHousehold(c, { type: "consumer", batteryCapacityKwh: 5 })).rejects.toThrow(/only prosumers/);
    await expect(seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 80 })).rejects.toThrow(/between 0 and 50/);
  });

  it("delivers purchases into the buyer's rented space and refuses what can't fit", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);
    const buyer = await seedHousehold(c, { type: "consumer" });
    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);

    env.rentedCapPerHouseholdKwh = 2;
    expect(() => c.trades.createTrade(buyer.id, offer.id, 3)).toThrow(/you can receive at most 2\.00 kWh/);
    env.sharedBatteryRentedShare = 0;
    expect(() => c.trades.createTrade(buyer.id, offer.id, 1)).toThrow(/Community storage full/);

    Object.assign(env, saved);
    const trade = await c.trades.purchase(buyer.id, offer.id, 2);
    expect(trade).toMatchObject({ status: "completed", sellerName: "Test Household", buyerName: "Test Household" });
    expect(c.households.getById(buyer.id).storedKwh).toBe(2);
    expect(c.marketplace.getOffer(offer.id).amountRemainingKwh).toBe(1);
  });

  it("settles nothing when a reserved purchase can no longer be delivered", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c);
    const buyer = await seedHousehold(c, { type: "consumer" });
    const offer = c.marketplace.createOffer(seller.id, 3, 0.2);
    const trade = c.trades.createTrade(buyer.id, offer.id, 3);

    env.rentedCapPerHouseholdKwh = 1; // shrank between reservation and execution
    await expect(c.trades.executeTrade(trade.id)).rejects.toThrow(/at most 1\.00 kWh/);

    expect(c.tokens.getBalance(buyer.id)).toBe(10); // no TEC moved
    expect(c.households.getById(seller.id).batteryChargeKwh).toBe(5); // no energy moved
    expect(c.marketplace.getOffer(offer.id)).toMatchObject({ status: "active", amountRemainingKwh: 3 });
    expect(c.trades.getById(trade.id).status).toBe("failed");
  });

  it("reports the shared battery and the market clock", async () => {
    const c = buildTestContainer();
    expect(c.grid.status()).toEqual({
      capacityKwh: 100,
      rented: { capacityKwh: 60, usedKwh: 0, households: 0, capPerHouseholdKwh: 10 },
      gridPool: { capacityKwh: 40, chargeKwh: 20, greenKwh: 0 },
      decayPerHour: 0.01,
      avg24h: 0.175,
      gridBuysBelow: 0.158,
      gridSellsAbove: 0.193,
    });
    expect(c.market.status()).toMatchObject({
      simTime: 360,
      interval: 0,
      paused: true,
      lastPrice: null,
      mockMode: false,
      band: { floor: 0.05, ceiling: 0.3, mid: 0.175, components: { wholesale: 0.08, networkFee: 0.09, taxes: 0.08, supplierMargin: 0.05, balancingCost: 0.03 } },
    });
  });
});
