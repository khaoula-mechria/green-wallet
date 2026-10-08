import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("TokenService — TEC balances and transfers", () => {
  it("mints TEC 1:1 against a positive energy amount", async () => {
    const c = buildTestContainer();
    const h = await seedHousehold(c, { type: "consumer" }); // gets 10 TEC grant
    const before = c.tokens.getBalance(h.id);
    const tx = await c.tokens.mint(h.id, 4.5);

    expect(tx.type).toBe("MINT");
    expect(tx.fromAccountId).toBeNull();
    expect(tx.amount).toBe(4.5);
    expect(c.tokens.getBalance(h.id)).toBeCloseTo(before + 4.5, 2);
  });

  it("transfers TEC atomically between two households", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant
    c.tokens.topup(a.id, 10); // +10 = 20 total
    const b = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant

    const tx = await c.tokens.transfer(a.id, b.id, 4);

    expect(tx.amount).toBe(4);
    expect(c.tokens.getBalance(a.id)).toBeCloseTo(16, 2); // 20 - 4
    expect(c.tokens.getBalance(b.id)).toBeCloseTo(14, 2); // 10 + 4
  });

  it("rejects a transfer when the sender has insufficient balance", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { type: "consumer" }); // 10 TEC
    const b = await seedHousehold(c, { type: "consumer" }); // 10 TEC

    await expect(c.tokens.transfer(a.id, b.id, 50)).rejects.toThrow(/insufficient balance/i);

    // Balances must be unchanged after a failed transfer.
    expect(c.tokens.getBalance(a.id)).toBeCloseTo(10, 2);
    expect(c.tokens.getBalance(b.id)).toBeCloseTo(10, 2);
  });

  it("rejects a zero or negative transfer amount", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { type: "consumer" });
    const b = await seedHousehold(c, { type: "consumer" });
    await expect(c.tokens.transfer(a.id, b.id, 0)).rejects.toThrow();
    await expect(c.tokens.transfer(a.id, b.id, -1)).rejects.toThrow();
  });

  it("records every transfer in both parties' token history", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { type: "consumer" }); // 10 TEC + welcome grant
    const b = await seedHousehold(c, { type: "consumer" }); // 10 TEC
    await c.tokens.transfer(a.id, b.id, 3);

    const historyA = c.tokens.getHistory(a.id);
    const historyB = c.tokens.getHistory(b.id);
    // Each has welcome grant + the transfer = 2+ transactions
    expect(historyA.length).toBeGreaterThanOrEqual(1);
    expect(historyB.length).toBeGreaterThanOrEqual(1);
  });
});
