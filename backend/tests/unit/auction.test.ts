import { describe, it, expect, afterEach } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";
import { seedDemoData } from "../../src/scripts/seedData.js";
import { env } from "../../src/config/env.js";
import { CLEARING_ACCOUNT, GRID_STORAGE_ACCOUNT, TREASURY_ACCOUNT, UTILITY_ACCOUNT } from "../../src/services/ledgerService.js";

const saved = { ...env };
afterEach(() => Object.assign(env, saved));

describe("Phase 3 — the auction settles every interval (DESIGN.md §4, §5, §6.4)", () => {
  it("clears at one price and settles through the clearing account, certificates included", async () => {
    const c = buildTestContainer();
    const farm = await seedHousehold(c, { type: "producer" }); // sells from 0.05
    const home = await seedHousehold(c, { type: "consumer" }); // buys up to 0.30, 10 TEC
    const treasuryBefore = c.ledger.treasuryBalance();
    await c.measurements.record(farm.id, 5, 0);
    await c.measurements.record(home.id, 0, 4);

    const { auction } = c.market.endInterval();

    // Merit order: farm 5 @0.05 and grid pool 20 @0.193 sell; home 4 @0.30 and grid pool 20 @0.158 buy.
    // The farm's 5 kWh go to the home (4) and the grid pool (1); last matched pair 0.05 / 0.158.
    expect(auction).toMatchObject({ clearingPrice: 0.104, volume: 5, exportedKwh: 0, importedKwh: 0 });
    // Buyers pay rounded up, sellers are paid rounded down; the cent left over goes to the treasury.
    expect(c.tokens.getBalance(home.id)).toBeCloseTo(10 - 0.42, 2); // ceil(4 × 0.104)
    expect(c.tokens.getBalance(farm.id)).toBeCloseTo(0.52, 2); // floor(5 × 0.104)
    expect(c.ledger.getBalance(CLEARING_ACCOUNT).balance).toBe(0);
    expect(c.ledger.treasuryBalance()).toBeCloseTo(treasuryBefore + 0.01, 2);

    // The farm's certificates follow its energy: 4 to the home (retired as it consumes them), 1 to the pool.
    expect(c.tokens.wallet(home.id).greenShare).toEqual({ solarKwh: 4, windKwh: 0, greyKwh: 0, percentGreen: 100 });
    expect(c.ledger.getCertificates(GRID_STORAGE_ACCOUNT)).toEqual({ solar: 1, wind: 0 });
    expect(c.grid.status().gridPool.chargeKwh).toBe(21);

    // Readings learn their outcome; the auction is on the ledger as one record.
    expect(c.households.getHistory(home.id, 1)[0].flow).toMatchObject({ bought: 4, settled: true, price: 0.104 });
    expect(c.households.getHistory(farm.id, 1)[0].flow).toMatchObject({ sold: 5, exported: 0, settled: true });
    const record = c.ledger.toLedgerTxs(c.ledger.getAllHistory(5, "RECORD"))[0];
    expect(record).toMatchObject({ type: "AUCTION_SUMMARY", amount: 5, memo: "Interval 0: cleared at 0.104 TEC/kWh, 5.00 kWh, 3 participants" });
    expect(c.analytics.checks()).toMatchObject({ money: { ok: true }, clearing: { ok: true }, energy: { ok: true }, certificates: { ok: true } });
  });

  it("sends what doesn't match to the utility: export at the floor, import at the ceiling", async () => {
    const c = buildTestContainer();
    const farm = await seedHousehold(c, { type: "producer", settings: { minSellPrice: 0.3 } });
    const home = await seedHousehold(c, { type: "consumer", settings: { maxBuyPrice: 0.05 } });
    await c.measurements.record(farm.id, 5, 0);
    await c.measurements.record(home.id, 0, 4);

    const { auction } = c.market.endInterval();

    expect(auction).toMatchObject({ clearingPrice: null, volume: 0, exportedKwh: 5, importedKwh: 4 });
    expect(c.tokens.wallet(farm.id).utility).toMatchObject({ exportedKwh: 5, exportCredit: 0.25 });
    expect(c.tokens.wallet(home.id).utility).toMatchObject({ importedKwh: 4, importCost: 1.2 });
    expect(c.tokens.wallet(home.id)).toMatchObject({ tokenBalance: 10, reservedTec: 0 }); // nobody cut off, no TEC spent
    expect(c.ledger.getCertificates(UTILITY_ACCOUNT)).toEqual({ solar: 5, wind: 0 });
    expect(c.households.getHistory(home.id, 1)[0].flow).toMatchObject({ imported: 4, settled: true, price: null });
  });

  it("caps a buyer's bid at what it can afford and imports the rest", async () => {
    const c = buildTestContainer();
    const farm = await seedHousehold(c, { type: "producer" });
    const home = await seedHousehold(c, { type: "consumer" });
    c.tokens.cashout(home.id, 9.5); // 0.50 TEC left
    await c.measurements.record(farm.id, 10, 0);
    await c.measurements.record(home.id, 0, 4);

    expect(c.tokens.wallet(home.id).reservedTec).toBe(0.5);
    expect(c.auction.myBid(home.id).bids[0].quantity).toBeCloseTo(0.5 / 0.3, 3);

    c.market.endInterval();

    const flow = c.households.getHistory(home.id, 1)[0].flow;
    expect(flow.bought).toBeCloseTo(1.667, 3);
    expect(flow.imported).toBeCloseTo(2.333, 3);
    expect(c.tokens.getBalance(home.id)).toBeGreaterThanOrEqual(0);
  });

  it("bids for each household from its settings: surplus, stored energy, battery above the reserve", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, {
      type: "prosumer",
      batteryCapacityKwh: 10,
      settings: { overflowMode: "store", minSellPrice: 0.08, storeMinPrice: 0.2, batterySell: { enabled: true, minPrice: 0.25, keepPercent: 40 } },
    });
    await c.measurements.record(home.id, 30, 0); // battery 10, storage 10, 10 waiting for the auction
    c.marketplace.createOffer(home.id, 3, 0.2); // listed from storage: not offered in the auction too

    expect(c.auction.myBid(home.id)).toEqual({
      side: "sell",
      bids: [
        { source: "surplus", quantity: 10, limitPrice: 0.08 },
        { source: "storage", quantity: 7, limitPrice: 0.2 },
        { source: "battery", quantity: 6, limitPrice: 0.25 }, // 10 - 40% kept
      ],
      pendingSellKwh: 10,
      pendingBuyKwh: 0,
      reservedTec: 0,
      optedOut: false,
    });

    c.households.updateSettings(home.id, { auctionOptOut: true });
    expect(c.auction.myBid(home.id)).toMatchObject({ bids: [], optedOut: true });
  });

  it("releases the reservation when a household opts out mid-interval", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "consumer" });
    await c.measurements.record(home.id, 0, 4);
    expect(c.tokens.wallet(home.id).reservedTec).toBe(1.2);

    c.households.updateSettings(home.id, { maxBuyPrice: 0.2 });
    expect(c.tokens.wallet(home.id).reservedTec).toBe(0.8);
    c.households.updateSettings(home.id, { auctionOptOut: true });
    expect(c.tokens.wallet(home.id).reservedTec).toBe(0);
  });

  it("covers a household's own deficit with its own pending surplus before bidding", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 0 });
    await c.measurements.record(home.id, 3, 0, "manual"); // 3 waiting to sell
    await c.measurements.record(home.id, 0, 2, "manual"); // 2 waiting to buy

    const { auction } = c.market.endInterval();

    expect(auction.bids.filter((b) => b.participantId === home.id).map((b) => [b.side, b.quantity])).toEqual([["sell", 1]]);
    expect(c.tokens.wallet(home.id).greenShare).toMatchObject({ solarKwh: 2, greyKwh: 0 });
  });

  it("moves the grid pool's limits with the 24-hour average price", async () => {
    const c = buildTestContainer();
    expect(c.grid.status()).toMatchObject({ avg24h: 0.175, gridBuysBelow: 0.158, gridSellsAbove: 0.193 });
    const farm = await seedHousehold(c, { type: "producer" });
    await c.measurements.record(farm.id, 5, 0); // only the pool buys: clears at (0.05 + 0.158) / 2

    c.market.endInterval();

    expect(c.grid.status()).toMatchObject({ avg24h: 0.104, gridBuysBelow: 0.094, gridSellsAbove: 0.114 });
    expect(c.market.status()).toMatchObject({ lastPrice: 0.104, avg24h: 0.104 });
  });

  it("keeps the clearing account at zero and every check green, interval after interval", async () => {
    const c = buildTestContainer();
    await seedDemoData(c, () => {});
    for (let i = 0; i < 24; i++) {
      await c.simulation.runInterval();
      expect(c.ledger.getBalance(CLEARING_ACCOUNT).balance).toBe(0);
      const checks = c.analytics.checks();
      expect(Object.values(checks).every((check) => check.ok), JSON.stringify(checks)).toBe(true);
    }
    expect(c.ledger.treasuryBalance()).toBeGreaterThanOrEqual(c.ledger.getBalance(TREASURY_ACCOUNT).balance);
  });

  it("runs the market clock on its own timer, without the simulation", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "consumer" });
    await c.measurements.record(home.id, 0, 1, "manual");
    env.marketIntervalMs = 100;

    c.market.start();
    expect(c.market.status().paused).toBe(false);
    await new Promise((r) => setTimeout(r, 350));
    c.market.stop();

    expect(c.clock.interval()).toBeGreaterThanOrEqual(2);
    expect(c.households.getHistory(home.id, 1)[0].flow.settled).toBe(true);
    expect(c.market.status().paused).toBe(true);
  });
});
