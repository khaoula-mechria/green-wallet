import { describe, it, expect } from "vitest";
import { clearAuction, type ClearingBid } from "../../src/market/clearing.js";

const bid = (quantity: number, limitPrice: number, name = ""): ClearingBid & { name: string } => ({ quantity, limitPrice, matched: 0, name });

describe("Uniform-price double auction (DESIGN.md §4.2)", () => {
  it("clears the noon example at 0.08 — the solar farm covers all 9 kWh", () => {
    const sells = [bid(20, 0.06, "solar farm"), bid(3, 0.08, "A"), bid(2, 0.12, "B")];
    const buys = [bid(4, 0.3), bid(3, 0.25), bid(2, 0.1)];

    const r = clearAuction(sells, buys);

    expect(r).toEqual({ price: 0.08, volume: 9, lastMatchedSellPrice: 0.06, lastMatchedBuyPrice: 0.1 });
    expect(sells.map((s) => s.matched)).toEqual([9, 0, 0]);
    expect(buys.map((b) => b.matched)).toEqual([4, 3, 2]);
  });

  it("clears the evening example at 0.21 — only 2 kWh for sale", () => {
    const sells = [bid(2, 0.12)];
    const buys = [bid(4, 0.3), bid(3, 0.25), bid(2, 0.1)];

    const r = clearAuction(sells, buys);

    expect(r).toMatchObject({ price: 0.21, volume: 2 });
    expect(buys.map((b) => b.matched)).toEqual([2, 0, 0]);
  });

  it("partially fills the marginal bid", () => {
    const sells = [bid(5, 0.1)];
    const buys = [bid(3, 0.2), bid(4, 0.15)];

    const r = clearAuction(sells, buys);

    expect(r).toMatchObject({ price: 0.125, volume: 5 });
    expect(buys.map((b) => b.matched)).toEqual([3, 2]);
  });

  it("shares ties at the same price pro rata", () => {
    const sells = [bid(4, 0.1, "A"), bid(2, 0.1, "B")];
    const buys = [bid(3, 0.2)];

    clearAuction(sells, buys);

    expect(sells.map((s) => s.matched)).toEqual([2, 1]);
  });

  it("returns no price when the cheapest seller asks more than the most eager buyer offers", () => {
    const sells = [bid(2, 0.25)];
    const buys = [bid(2, 0.2)];

    expect(clearAuction(sells, buys)).toEqual({ price: null, volume: 0, lastMatchedSellPrice: null, lastMatchedBuyPrice: null });
    expect([...sells, ...buys].every((b) => b.matched === 0)).toBe(true);
  });

  it("always balances, respects every limit and stays inside the band (randomised)", () => {
    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    for (let run = 0; run < 300; run++) {
      const sells = Array.from({ length: Math.floor(rand(0, 8)) }, () => bid(rand(0.01, 10), Math.round(rand(0.05, 0.3) * 1000) / 1000));
      const buys = Array.from({ length: Math.floor(rand(0, 8)) }, () => bid(rand(0.01, 10), Math.round(rand(0.05, 0.3) * 1000) / 1000));

      const r = clearAuction(sells, buys);

      const sold = sells.reduce((s, b) => s + b.matched, 0);
      const bought = buys.reduce((s, b) => s + b.matched, 0);
      expect(sold).toBeCloseTo(r.volume, 6);
      expect(bought).toBeCloseTo(r.volume, 6);
      for (const b of [...sells, ...buys]) expect(b.matched).toBeLessThanOrEqual(b.quantity + 1e-9);
      if (r.price === null) continue;
      expect(r.price).toBeGreaterThanOrEqual(0.05);
      expect(r.price).toBeLessThanOrEqual(0.3);
      // Nobody trades against their own limit (within the price's 0.001 rounding).
      for (const s of sells) if (s.matched > 1e-9) expect(s.limitPrice).toBeLessThanOrEqual(r.price + 0.0005);
      for (const b of buys) if (b.matched > 1e-9) expect(b.limitPrice).toBeGreaterThanOrEqual(r.price - 0.0005);
    }
  });
});
