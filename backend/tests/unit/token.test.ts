import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("TokenService — TEC balances and transfers", () => {
  it("mints TEC 1:1 against a positive energy amount", async () => {
    const c = buildTestContainer();
    const h = await seedHousehold(c);
    const tx = await c.tokens.mint(h.id, 4.5);

    expect(tx.type).toBe("MINT");
    expect(tx.fromHouseholdId).toBeNull();
    expect(tx.amount).toBe(4.5);
    expect(c.tokens.getBalance(h.id)).toBe(4.5);
  });

  it("transfers TEC atomically between two households", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { initialTokenBalance: 10 });
    const b = await seedHousehold(c, { initialTokenBalance: 0 });

    const tx = await c.tokens.transfer(a.id, b.id, 4);

    expect(tx.amount).toBe(4);
    expect(c.tokens.getBalance(a.id)).toBe(6);
    expect(c.tokens.getBalance(b.id)).toBe(4);
  });

  it("rejects a transfer when the sender has insufficient balance", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { initialTokenBalance: 2 });
    const b = await seedHousehold(c, { initialTokenBalance: 0 });

    await expect(c.tokens.transfer(a.id, b.id, 5)).rejects.toThrow(/insufficient token balance/i);

    // Balances must be unchanged after a failed transfer.
    expect(c.tokens.getBalance(a.id)).toBe(2);
    expect(c.tokens.getBalance(b.id)).toBe(0);
  });

  it("rejects a zero or negative transfer amount", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { initialTokenBalance: 10 });
    const b = await seedHousehold(c);
    await expect(c.tokens.transfer(a.id, b.id, 0)).rejects.toThrow();
    await expect(c.tokens.transfer(a.id, b.id, -1)).rejects.toThrow();
  });

  it("records every transfer in both parties' token history", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { initialTokenBalance: 10 });
    const b = await seedHousehold(c);
    await c.tokens.transfer(a.id, b.id, 3);

    // a: the starting GRANT + the transfer out; b: the transfer in.
    expect(c.tokens.getHistory(a.id).map((t) => t.type).sort()).toEqual(["GRANT", "TRANSFER"]);
    expect(c.tokens.getHistory(b.id).map((t) => t.type)).toEqual(["TRANSFER"]);
  });

  it("records starting balances as ledger-backed GRANTs", async () => {
    const c = buildTestContainer();
    const a = await seedHousehold(c, { initialTokenBalance: 10 });
    const [grant] = c.tokens.getHistory(a.id);
    expect(grant.type).toBe("GRANT");
    expect(grant.amount).toBe(10);
    expect(grant.blockchainTxId).toBeTruthy();
  });
});
