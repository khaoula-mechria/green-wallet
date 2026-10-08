import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold, seedSeller } from "../testContainer.js";
import type { Container } from "../../src/container.js";
import { UTILITY_ACCOUNT } from "../../src/services/ledgerService.js";

/** DESIGN.md §2.3: every household's certificates are backed by kWh it owns. */
function expectCertificatesBackedByEnergy(c: Container) {
  for (const h of c.households.getAll()) {
    const held = c.tokens.wallet(h.id).certificates;
    expect(held.solar + held.wind).toBeLessThanOrEqual(c.certificates.stockKwh(h.id) + 0.011);
  }
}

function expectBalanced(c: Container) {
  const checks = c.analytics.checks();
  expect(checks.certificates.ok).toBe(true);
  expect(checks.money.ok).toBe(true);
  expect(checks.energy.ok).toBe(true);
}

describe("Green certificates follow the kWh (DESIGN.md §2)", () => {
  it("certifies a wind farm's output as WIND and hands it to the utility with the export", async () => {
    const c = buildTestContainer();
    const farm = await seedHousehold(c, { type: "producer", energyType: "wind" });

    const { certificateTx } = await c.measurements.record(farm.id, 6, 0);

    expect(certificateTx!.asset).toBe("WIND");
    expect(c.tokens.wallet(farm.id).certificates).toEqual({ solar: 0, wind: 0 });
    expect(c.ledger.getCertificates(UTILITY_ACCOUNT)).toEqual({ solar: 0, wind: 6 });
    expect(c.tokens.getBalance(farm.id)).toBe(0);
    expectBalanced(c);
  });

  it("covers a prosumer's deficit from its own battery first and retires those certificates", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer" }); // 10 kWh battery

    await c.measurements.record(home.id, 5, 2); // 3 kWh into the battery, 3 SOLAR held
    const night = await c.measurements.record(home.id, 0, 2);

    expect(night.retired).toEqual({ solar: 2, wind: 0 });
    expect(night.measurement.flow).toMatchObject({ fromBattery: 2, imported: 0 });
    expect(c.households.getById(home.id).batteryChargeKwh).toBe(1);
    expect(c.tokens.wallet(home.id).certificates).toEqual({ solar: 1, wind: 0 });
    // 2 self-used + 2 from the battery, all green.
    expect(c.tokens.wallet(home.id).greenShare).toEqual({ solarKwh: 4, windKwh: 0, greyKwh: 0, percentGreen: 100 });
  });

  it("imports what its own stock can't cover — grey energy on the utility bill", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer" });

    await c.measurements.record(home.id, 3, 2); // 1 kWh into the battery
    await c.measurements.record(home.id, 0, 3); // 1 from the battery, 2 imported

    const wallet = c.tokens.wallet(home.id);
    expect(c.households.getById(home.id).batteryChargeKwh).toBe(0);
    expect(wallet.greenShare).toEqual({ solarKwh: 3, windKwh: 0, greyKwh: 2, percentGreen: 60 });
    expect(wallet.utility).toMatchObject({ importedKwh: 2, importCost: 0.6 });
  });

  it("moves certificates in proportion to the seller's whole stock, grey energy included", async () => {
    const c = buildTestContainer();
    const seller = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 10, settings: { batterySell: { keepPercent: 0 } } });
    const buyer = await seedHousehold(c, { type: "consumer" });
    c.grid.injectInitialCharge(seller.id, 4); // 4 kWh grey (no certificates)
    await c.measurements.record(seller.id, 8, 2); // +6 SOLAR → battery 10: 6 green, 4 grey

    const offer = c.marketplace.createOffer(seller.id, 5, 0.1);
    const trade = await c.trades.purchase(buyer.id, offer.id, 5);

    expect(trade.certificates).toEqual({ solar: 3, wind: 0 }); // 5 kWh × 6/10
    expect(c.tokens.wallet(buyer.id).certificates).toEqual({ solar: 3, wind: 0 });
    expect(c.tokens.wallet(seller.id).certificates).toEqual({ solar: 3, wind: 0 });

    // The buyer's stored energy is 60% green: consuming 1 kWh retires 0.6 SOLAR.
    const { retired } = await c.measurements.record(buyer.id, 0, 1);
    expect(retired).toEqual({ solar: 0.6, wind: 0 });

    expectCertificatesBackedByEnergy(c);
    expectBalanced(c);
  });

  it("keeps certificates with listed energy when an offer is cancelled or a purchase fails", async () => {
    const c = buildTestContainer();
    const seller = await seedSeller(c); // 5 kWh in the battery, 5 SOLAR
    const poor = await seedHousehold(c, { type: "consumer" });
    c.tokens.cashout(poor.id, 10); // no TEC left

    const offer = c.marketplace.createOffer(seller.id, 3, 0.3);
    await expect(c.trades.purchase(poor.id, offer.id, 3)).rejects.toThrow(/insufficient/i);
    c.marketplace.cancelOffer(seller.id, offer.id);

    expect(c.households.getById(seller.id).batteryChargeKwh).toBe(5);
    expect(c.tokens.wallet(seller.id).certificates).toEqual({ solar: 5, wind: 0 });
    expect(c.tokens.wallet(poor.id).certificates).toEqual({ solar: 0, wind: 0 });
    expectBalanced(c);
  });

  it("records every certificate movement on the ledger with a Hedera-style ID", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer", name: "Rooftop" });
    await c.measurements.record(home.id, 4, 1);

    const certs = c.ledger.toLedgerTxs(c.ledger.getAllHistory(50, "CERT"));
    const issue = certs.find((t) => t.type === "CERT_ISSUE")!;
    const retire = certs.find((t) => t.type === "CERT_RETIRE")!;

    expect(issue).toMatchObject({ asset: "SOLAR", amount: 4, fromLabel: "Issued", toLabel: "Rooftop", householdIds: [home.id] });
    expect(retire).toMatchObject({ asset: "SOLAR", amount: 1, fromLabel: "Rooftop", toLabel: "Retired" });
    expect(issue.id).toMatch(/^0\.0\.1000@\d+\.\d{9}$/);
    expect(issue.blockIndex).not.toBeNull();
    // No TEC moved for this household besides its welcome grant.
    const account = c.ledger.getHouseholdAccount(home.id).id;
    expect(c.ledger.getAllHistory(50, "TEC").some((t) => t.toAccountId === account && t.type !== "WELCOME_GRANT")).toBe(false);
  });

  it("rejects production reported by a consumer", async () => {
    const c = buildTestContainer();
    const consumer = await seedHousehold(c, { type: "consumer" });
    await expect(c.measurements.record(consumer.id, 1, 2)).rejects.toThrow(/consumers do not produce/);
  });

  it("enforces each role's energy source at registration", async () => {
    const c = buildTestContainer();
    expect((await seedHousehold(c, { type: "producer", energyType: "wind" })).energyType).toBe("wind");
    expect((await seedHousehold(c, { type: "prosumer" })).energyType).toBe("solar");
    expect((await seedHousehold(c, { type: "consumer" })).energyType).toBe("grid");
    await expect(seedHousehold(c, { type: "prosumer", energyType: "wind" })).rejects.toThrow(/must be solar/);
    await expect(seedHousehold(c, { type: "consumer", energyType: "solar" })).rejects.toThrow(/must be grid/);
  });

  it("reports the microgrid's green share and the certificate check on the dashboard", async () => {
    const c = buildTestContainer();
    const home = await seedHousehold(c, { type: "prosumer" });
    const consumer = await seedHousehold(c, { type: "consumer" });
    await c.measurements.record(home.id, 3, 1); // 1 solar consumed
    await c.measurements.record(consumer.id, 0, 3); // 3 grey

    const dashboard = c.analytics.getDashboard();
    expect(dashboard.greenShare).toEqual({ solarKwh: 1, windKwh: 0, greyKwh: 3, percentGreen: 25 });
    expect(dashboard.checks.certificates).toEqual({ ok: true, issued: 3, accounted: 3 });
  });
});
