import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold, seedSeller } from "../testContainer.js";

async function setupOffer(c: ReturnType<typeof buildTestContainer>, amount = 3, price = 0.2) {
  const producer = await seedSeller(c); // prosumer, 5 kWh in its battery, can list 3
  const offer = c.marketplace.createOffer(producer.id, amount, price);
  return { producer, offer };
}

describe("TradeService — purchasing energy", () => {
  it("completes a trade end-to-end: tokens move, energy moves, offer updates", async () => {
    const c = buildTestContainer();
    const { producer, offer } = await setupOffer(c, 3, 0.2);
    const buyer = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant
    c.tokens.topup(buyer.id, 10); // total 20 TEC

    const trade = await c.trades.purchase(buyer.id, offer.id, 3);

    expect(trade.status).toBe("completed");
    expect(trade.totalPrice).toBeCloseTo(0.6);
    expect(trade.ledgerTxId).toBeTruthy();

    // Buyer: started 20, spent 0.6; the 3 kWh are delivered into its rented space in the shared battery.
    expect(c.tokens.getBalance(buyer.id)).toBeCloseTo(19.4, 2);
    expect(c.households.getById(buyer.id).storedKwh).toBe(3);

    // Seller: welcome grant 10 + 0.6 from the sale (production earns certificates, not TEC);
    // the kWh left its battery.
    expect(c.tokens.getBalance(producer.id)).toBeCloseTo(10.6, 2);
    expect(c.households.getById(producer.id).batteryChargeKwh).toBe(2);

    // The 3 kWh sold carry their 3 SOLAR certificates to the buyer.
    expect(trade.certificates).toEqual({ solar: 3, wind: 0 });
    expect(c.tokens.wallet(buyer.id).certificates).toEqual({ solar: 3, wind: 0 });
    expect(c.tokens.wallet(producer.id).certificates).toEqual({ solar: 2, wind: 0 });

    const updatedOffer = c.marketplace.getOffer(offer.id);
    expect(updatedOffer.status).toBe("completed");
    expect(updatedOffer.amountRemainingKwh).toBe(0);
  });

  it("rejects a purchase when the buyer has insufficient token balance", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 0.2); // totalPrice = 0.6
    const buyer = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant
    c.tokens.cashout(buyer.id, 9.5); // 0.5 left

    await expect(c.trades.purchase(buyer.id, offer.id, 3)).rejects.toThrow(/insufficient balance/i);
    // Nothing settled: no energy delivered.
    expect(c.households.getById(buyer.id).storedKwh).toBe(0);

    // Offer capacity must be released back after a failed execution.
    const restoredOffer = c.marketplace.getOffer(offer.id);
    expect(restoredOffer.status).toBe("active");
    expect(restoredOffer.amountRemainingKwh).toBe(3);
  });

  it("rejects a purchase larger than the offer's remaining energy", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 0.2);
    const buyer = await seedHousehold(c, { type: "consumer" });
    c.tokens.topup(buyer.id, 100);

    expect(() => c.trades.createTrade(buyer.id, offer.id, 5)).toThrow(/only has/i);
  });

  it("prevents a household from buying its own offer", async () => {
    const c = buildTestContainer();
    const { producer, offer } = await setupOffer(c, 3, 0.2);
    expect(() => c.trades.createTrade(producer.id, offer.id, 1)).toThrow(/cannot buy its own offer/i);
  });

  it("prevents duplicate execution of the same trade (double-settlement guard)", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 0.2);
    const buyer = await seedHousehold(c, { type: "consumer" }); // 10 TEC
    c.tokens.topup(buyer.id, 10); // total 20 TEC

    const trade = c.trades.createTrade(buyer.id, offer.id, 3);
    await c.trades.executeTrade(trade.id);

    await expect(c.trades.executeTrade(trade.id)).rejects.toThrow(/already completed|refusing duplicate/i);

    // Balance must reflect exactly one settlement, not two: 20 - 0.6 = 19.4
    const buyerBalance = c.tokens.getBalance(buyer.id);
    expect(buyerBalance).toBeCloseTo(19.4, 2);
  });

  it("prevents overselling an offer across two concurrent purchase attempts", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 0.2);
    const buyerA = await seedHousehold(c, { type: "consumer" }); // 10 TEC
    c.tokens.topup(buyerA.id, 10); // total 20
    const buyerB = await seedHousehold(c, { type: "consumer" }); // 10 TEC
    c.tokens.topup(buyerB.id, 10); // total 20

    // First buyer takes the entire 3 kWh.
    await c.trades.purchase(buyerA.id, offer.id, 3);

    // Second buyer must not be able to buy from the now-exhausted offer.
    await expect(c.trades.purchase(buyerB.id, offer.id, 1)).rejects.toThrow();
  });
});
