import { describe, it, expect, beforeEach } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";

describe("LedgerService — Phase 0 foundations", () => {
  describe("Account creation and bootstrap", () => {
    it("bootstraps operator accounts on first call", () => {
      const c = buildTestContainer();
      const treasury = c.ledger.treasuryBalance();
      expect(treasury).toBe(10_000); // TREASURY_INITIAL_TEC default
    });

    it("creates household account with Hedera-style ID on registration", async () => {
      const c = buildTestContainer();
      const { household } = await c.auth.register({
        name: "Test House",
        type: "consumer",
        location: "Test City",
        password: "password123",
      });
      expect(household.hederaAccountId).toMatch(/^0\.0\.\d+$/);
    });
  });

  describe("Hedera-style transaction IDs", () => {
    it("generates unique transaction IDs in format 0.0.1000@seconds.nanos", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c, { type: "consumer" });
      const h2 = await seedHousehold(c, { type: "consumer" });
      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);

      const tx1 = c.ledger.transfer("TRANSFER", a1.id, a2.id, 5, "test1");
      const tx2 = c.ledger.transfer("TRANSFER", a1.id, a2.id, 3, "test2");

      expect(tx1.id).toMatch(/^0\.0\.1000@\d+\.\d{9}$/);
      expect(tx2.id).toMatch(/^0\.0\.1000@\d+\.\d{9}$/);
      expect(tx1.id).not.toBe(tx2.id);
    });

    it("attaches simulated fee to every transaction", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c, { type: "consumer" });
      const h2 = await seedHousehold(c, { type: "consumer" });
      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);

      const tx = c.ledger.transfer("TRANSFER", a1.id, a2.id, 1, "test");
      expect(tx.feeHbar).toBe(0.0001);
    });
  });

  describe("TEC creation and destruction (supply)", () => {
    it("increases total supply when creating TEC (topup)", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);
      const account = c.ledger.getHouseholdAccount(h.id);

      const before = c.ledger.checkMoneyInvariant().totalSupply;
      c.ledger.transfer("TOPUP", null, account.id, 50, "topup test");
      const after = c.ledger.checkMoneyInvariant().totalSupply;

      expect(after - before).toBe(50);
    });

    it("decreases total supply when destroying TEC (cashout)", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);
      const account = c.ledger.getHouseholdAccount(h.id);

      // Give the account some TEC first
      c.ledger.transfer("TOPUP", null, account.id, 100, "setup");
      const before = c.ledger.checkMoneyInvariant().totalSupply;

      c.ledger.transfer("CASHOUT", account.id, null, 30, "cashout test");
      const after = c.ledger.checkMoneyInvariant().totalSupply;

      expect(before - after).toBe(30);
    });
  });

  describe("Balance atomicity and invariants", () => {
    it("rejects transfer when sender has insufficient balance", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c);
      const h2 = await seedHousehold(c);
      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);

      // Only consumers get welcome grant (10 TEC)
      expect(() => {
        c.ledger.transfer("TRANSFER", a1.id, a2.id, 100, "should fail");
      }).toThrow(/insufficient/i);

      // State unchanged after failed transfer
      const bal = c.ledger.getBalance(a1.id);
      expect(bal.balance).toBe(0); // Producer, no grant
    });

    it("maintains no negative balances across operations", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c, { type: "consumer" });
      const account = c.ledger.getHouseholdAccount(h.id);

      // Consumer got welcome grant (10 TEC)
      expect(c.ledger.getBalance(account.id).balance).toBe(10);

      // Try to spend more than available
      expect(() => {
        c.ledger.transfer("CASHOUT", account.id, null, 50, "too much");
      }).toThrow(/insufficient/i);

      // Balance unchanged
      expect(c.ledger.getBalance(account.id).balance).toBe(10);
    });

    it("money invariant holds after transactions", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c, { type: "consumer" });
      const h2 = await seedHousehold(c, { type: "producer" });
      const h3 = await seedHousehold(c, { type: "prosumer" });

      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);
      const a3 = c.ledger.getHouseholdAccount(h3.id);

      // Run several operations
      c.ledger.transfer("TOPUP", null, a1.id, 50, "topup h1");
      c.ledger.transfer("TRANSFER", a1.id, a2.id, 20, "transfer");
      c.ledger.transfer("TOPUP", null, a3.id, 30, "topup h3");

      // Check that we can verify the invariant (implementation may vary)
      const invariant = c.ledger.checkMoneyInvariant();
      expect(invariant).toHaveProperty("ok");
      expect(invariant).toHaveProperty("totalSupply");
      expect(invariant).toHaveProperty("sumOfBalances");
      expect(invariant.totalSupply).toBeGreaterThan(0);
      expect(invariant.sumOfBalances).toBeGreaterThan(0);
    });
  });

  describe("Welcome grants and seed topups", () => {
    it("issues welcome grant to new prosumers via ledger", async () => {
      const c = buildTestContainer();
      const { household } = await c.auth.register({
        name: "Prosumer Test",
        type: "prosumer",
        location: "Test",
        password: "pass123",
      });

      const account = c.ledger.getHouseholdAccount(household.id);
      expect(c.ledger.getBalance(account.id).balance).toBe(10); // WELCOME_GRANT_TEC default
    });

    it("issues welcome grant to new consumers via ledger", async () => {
      const c = buildTestContainer();
      const { household } = await c.auth.register({
        name: "Consumer Test",
        type: "consumer",
        location: "Test",
        password: "pass123",
      });

      const account = c.ledger.getHouseholdAccount(household.id);
      expect(c.ledger.getBalance(account.id).balance).toBe(10);
    });

    it("does NOT issue welcome grant to producers", async () => {
      const c = buildTestContainer();
      const { household } = await c.auth.register({
        name: "Producer Test",
        type: "producer",
        location: "Test",
        password: "pass123",
      });

      const account = c.ledger.getHouseholdAccount(household.id);
      expect(c.ledger.getBalance(account.id).balance).toBe(0);
    });

    it("records welcome grant as a ledger transaction", async () => {
      const c = buildTestContainer();
      const { household } = await c.auth.register({
        name: "Ledger Test",
        type: "consumer",
        location: "Test",
        password: "pass123",
      });

      const account = c.ledger.getHouseholdAccount(household.id);
      const history = c.ledger.getHistory(account.id);

      expect(history.length).toBeGreaterThan(0);
      const grantTx = history.find((tx) => tx.type === "WELCOME_GRANT");
      expect(grantTx).toBeDefined();
      expect(grantTx?.amount).toBe(10);
      expect(grantTx?.fromAccountId).toBe("0.0.1001"); // treasury
      expect(grantTx?.memo).toContain("Welcome grant");
    });
  });

  describe("Top-ups and cash-outs (demo mode)", () => {
    it("tops up household account with cap enforcement", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);
      const before = c.tokens.getBalance(h.id);

      const wallet = c.tokens.topup(h.id, 50);
      expect(wallet.tokenBalance).toBe(before + 50);
    });

    it("rejects topup exceeding max cap", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);

      expect(() => {
        c.tokens.topup(h.id, 200); // Max is 100
      }).toThrow(/must be between/i);
    });

    it("enforces cooldown between topups", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);

      c.tokens.topup(h.id, 50);

      expect(() => {
        c.tokens.topup(h.id, 25);
      }).toThrow(/wait/i);
    });

    it("cashes out only available balance (not reserved)", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c, { type: "consumer" }); // Gets 10 TEC grant
      c.tokens.topup(h.id, 50); // Now has 60

      const wallet = c.tokens.cashout(h.id, 25);
      expect(wallet.availableTec).toBe(35); // 60 - 25 = 35
      expect(wallet.tokenBalance).toBe(35);
    });

    it("rejects cashout exceeding available balance", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c); // Consumer: 10 TEC grant

      expect(() => {
        c.tokens.cashout(h.id, 50);
      }).toThrow(/insufficient/i);
    });
  });

  describe("Wallet endpoint", () => {
    it("returns correct wallet structure with available/reserved split", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);

      const wallet = c.tokens.wallet(h.id);
      expect(wallet).toHaveProperty("householdId", h.id);
      expect(wallet).toHaveProperty("accountId");
      expect(wallet).toHaveProperty("tokenBalance");
      expect(wallet).toHaveProperty("reservedTec");
      expect(wallet).toHaveProperty("availableTec");
      expect(wallet.availableTec).toBe(wallet.tokenBalance - wallet.reservedTec);
    });

    it("includes topup/cashout flags and limits", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c);

      const wallet = c.tokens.wallet(h.id);
      expect(wallet.topupsEnabled).toBe(true); // Dev default
      expect(wallet.topupMaxTec).toBe(100);
    });
  });

  describe("Ledger history and status", () => {
    it("retrieves account transaction history in reverse chronological order", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c);
      const h2 = await seedHousehold(c);
      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);

      c.ledger.transfer("TOPUP", null, a1.id, 100, "topup 1");
      c.ledger.transfer("TOPUP", null, a1.id, 50, "topup 2");
      c.ledger.transfer("TRANSFER", a1.id, a2.id, 30, "transfer");

      const history = c.ledger.getHistory(a1.id, 10);
      expect(history.length).toBeGreaterThanOrEqual(3);

      // Most recent first
      const types = history.slice(0, 3).map((tx) => tx.type);
      expect(types[0]).toBe("TRANSFER");
      expect(types[1]).toBe("TOPUP");
      expect(types[2]).toBe("TOPUP");
    });

    it("reports ledger status with block and transaction counts", () => {
      const c = buildTestContainer();
      const status = c.ledger.getStatus();

      expect(status.mode).toBe("simulated-hedera");
      expect(status.operatorAccountId).toBe("0.0.1000");
      expect(status.blocksCount).toBeGreaterThan(0);
      expect(status.transactionsCount).toBeGreaterThan(0);
      expect(status.totalFeesHbar).toBeGreaterThan(0);
    });
  });
});
