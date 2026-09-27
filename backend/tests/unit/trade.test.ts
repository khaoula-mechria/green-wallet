import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

async function setupOffer(c: ReturnType<typeof buildTestContainer>, amount = 3, price = 0.2) {
  const producer = await seedHousehold(c, { type: "producer" });
  await c.measurements.record(producer.id, 8, 3); // surplus 5
  const offer = c.marketplace.createOffer(producer.id, amount, price);
  return { producer, offer };
}

describe("TradeService — purchasing energy", () => {
  it("completes a trade end-to-end: tokens move, energy moves, offer updates", async () => {
    const c = buildTestContainer();
    const { producer, offer } = await setupOffer(c, 3, 0.2);
    const buyer = await seedHousehold(c, { type: "consumer", initialTokenBalance: 10 });

    const { trade } = await c.trades.purchase(buyer.id, offer.id, 3);

    expect(trade.status).toBe("completed");
    expect(trade.totalPrice).toBeCloseTo(0.6);
    expect(trade.blockchainTxId).toBeTruthy();

    const buyerAfter = c.households.getById(buyer.id);
    const sellerAfter = c.households.getById(producer.id);
    expect(buyerAfter.tokenBalance).toBeCloseTo(10 - 0.6);
    expect(buyerAfter.energyBalance).toBe(3);
    // Seller started with 5 TEC minted from their own surplus measurement, plus 0.6 from this sale.
    expect(sellerAfter.tokenBalance).toBeCloseTo(5.6);

    const updatedOffer = c.marketplace.getOffer(offer.id);
    expect(updatedOffer.status).toBe("completed");
    expect(updatedOffer.amountRemainingKwh).toBe(0);
  });

  it("rejects a purchase when the buyer has insufficient token balance", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 5); // totalPrice = 15
    const buyer = await seedHousehold(c, { type: "consumer", initialTokenBalance: 1 });

    await expect(c.trades.purchase(buyer.id, offer.id, 3)).rejects.toThrow(/insufficient token balance/i);

    // Offer capacity must be released back after a failed execution.
    const restoredOffer = c.marketplace.getOffer(offer.id);
    expect(restoredOffer.status).toBe("active");
    expect(restoredOffer.amountRemainingKwh).toBe(3);
  });

  it("rejects a purchase larger than the offer's remaining energy", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 0.2);
    const buyer = await seedHousehold(c, { type: "consumer", initialTokenBalance: 100 });

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
    const buyer = await seedHousehold(c, { type: "consumer", initialTokenBalance: 10 });

    const trade = c.trades.createTrade(buyer.id, offer.id, 3);
    await c.trades.executeTrade(trade.id);

    await expect(c.trades.executeTrade(trade.id)).rejects.toThrow(/already completed|refusing duplicate/i);

    // Balance must reflect exactly one settlement, not two.
    const buyerAfter = c.households.getById(buyer.id);
    expect(buyerAfter.tokenBalance).toBeCloseTo(10 - 0.6);
  });

  it("prevents overselling an offer across two concurrent purchase attempts", async () => {
    const c = buildTestContainer();
    const { offer } = await setupOffer(c, 3, 0.2);
    const buyerA = await seedHousehold(c, { type: "consumer", initialTokenBalance: 10 });
    const buyerB = await seedHousehold(c, { type: "consumer", initialTokenBalance: 10 });

    // First buyer takes the entire 3 kWh.
    await c.trades.purchase(buyerA.id, offer.id, 3);

    // Second buyer must not be able to buy from the now-exhausted offer.
    await expect(c.trades.purchase(buyerB.id, offer.id, 1)).rejects.toThrow();
  });
});
