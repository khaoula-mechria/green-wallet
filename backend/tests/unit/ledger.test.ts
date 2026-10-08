import { describe, it, expect } from "vitest";
import { buildTestContainer, seedHousehold } from "../testContainer.js";
import { env } from "../../src/config/env.js";
import { isBlockHashValid } from "../../src/blockchain/hash.js";

describe("LedgerService — Phase 0 foundations", () => {
  describe("Account creation and bootstrap", () => {
    it("funds the treasury, then grid storage from the treasury, through ledger transactions", () => {
      const c = buildTestContainer();
      expect(c.ledger.treasuryBalance()).toBe(env.treasuryInitialTec - env.gridStorageInitialTec);
      expect(c.ledger.getBalance("0.0.1003").balance).toBe(env.gridStorageInitialTec);

      const funding = c.ledger.getHistory("0.0.1003");
      expect(funding).toHaveLength(1);
      expect(funding[0]).toMatchObject({ type: "OPERATOR_FUNDING", fromAccountId: "0.0.1001", amount: env.gridStorageInitialTec });
      expect(c.ledger.checkMoneyInvariant()).toEqual({ ok: true, totalSupply: env.treasuryInitialTec, sumOfBalances: env.treasuryInitialTec });
    });

    it("bootstrap is idempotent", () => {
      const c = buildTestContainer();
      const before = c.ledger.getStatus().transactionsCount;
      c.ledger.bootstrap();
      expect(c.ledger.getStatus().transactionsCount).toBe(before);
      expect(c.ledger.treasuryBalance()).toBe(env.treasuryInitialTec - env.gridStorageInitialTec);
    });

    it("allocates household accounts from 0.0.4801 upward", async () => {
      const c = buildTestContainer();
      const reg = (name: string) => c.auth.register({ name, type: "consumer", location: "Test City", password: "password123" });
      expect((await reg("First")).household.accountId).toBe("0.0.4801");
      expect((await reg("Second")).household.accountId).toBe("0.0.4802");
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

    it("money invariant holds: Σ balances = total supply (strict)", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c, { type: "consumer" }); // 10 TEC grant
      const h2 = await seedHousehold(c, { type: "producer" }); // 0
      const h3 = await seedHousehold(c, { type: "prosumer" }); // 10 TEC grant

      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);
      const a3 = c.ledger.getHouseholdAccount(h3.id);

      // Grants move existing treasury TEC; top-ups create TEC; cash-outs destroy it.
      c.ledger.transfer("TOPUP", null, a1.id, 50, "topup h1");
      c.ledger.transfer("TRANSFER", a1.id, a2.id, 20, "transfer");
      c.ledger.transfer("TOPUP", null, a3.id, 30, "topup h3");
      c.ledger.transfer("CASHOUT", a3.id, null, 15, "cashout h3");

      const invariant = c.ledger.checkMoneyInvariant();
      expect(invariant.ok).toBe(true);
      expect(invariant.totalSupply).toBe(env.treasuryInitialTec + 50 + 30 - 15);
      expect(invariant.sumOfBalances).toBe(invariant.totalSupply);
    });

    it("money invariant covers the whole ledger, not just the latest page of transactions", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c, { type: "consumer" });
      const h2 = await seedHousehold(c, { type: "consumer" });
      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);

      for (let i = 0; i < 220; i++) c.ledger.transfer("TOPUP", null, i % 2 ? a1.id : a2.id, 1.37, `topup ${i}`);

      const invariant = c.ledger.checkMoneyInvariant();
      expect(invariant.ok).toBe(true);
      expect(invariant.totalSupply).toBeCloseTo(env.treasuryInitialTec + 220 * 1.37, 2);
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

  describe("Block sealing", () => {
    it("seals every transaction into its own block on a valid hash chain", async () => {
      const c = buildTestContainer();
      const h1 = await seedHousehold(c, { type: "consumer" });
      const h2 = await seedHousehold(c, { type: "consumer" });
      const a1 = c.ledger.getHouseholdAccount(h1.id);
      const a2 = c.ledger.getHouseholdAccount(h2.id);

      const tx1 = c.ledger.transfer("TRANSFER", a1.id, a2.id, 5, "test1");
      const tx2 = c.ledger.transfer("TRANSFER", a1.id, a2.id, 3, "test2");

      expect(tx1.blockIndex).not.toBeNull();
      expect(tx2.blockIndex).toBe(tx1.blockIndex! + 1);
      expect(c.blockchain.getBlock(tx1.blockIndex!)!.transactionIds).toEqual([tx1.id]);
      expect(c.blockchain.getBlock(tx2.blockIndex!)!.transactionIds).toEqual([tx2.id]);

      const chain = c.blockchain.getChain();
      expect(chain[0].index).toBe(0); // genesis comes before the bootstrap transactions
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].index).toBe(i);
        expect(chain[i].previousHash).toBe(chain[i - 1].hash);
        expect(isBlockHashValid(chain[i])).toBe(true);
      }
      expect(c.ledger.getStatus().latestHash).toBe(chain.at(-1)!.hash);
    });

    it("rolls back the block when the transfer fails", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c, { type: "consumer" });
      const blocksBefore = c.blockchain.getChain().length;

      expect(() => c.ledger.transfer("CASHOUT", c.ledger.getHouseholdAccount(h.id).id, null, 999, "too much")).toThrow(/insufficient/);
      expect(c.blockchain.getChain()).toHaveLength(blocksBefore);
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

    it("reports ledger status in the LedgerStatus contract shape", () => {
      const c = buildTestContainer();
      const status = c.ledger.getStatus();

      expect(status).toEqual({
        mode: "simulated-hedera",
        network: "testnet (simulated)",
        operatorAccountId: "0.0.1000",
        tokenIds: { TEC: "0.0.5001", SOLAR: "0.0.5002", WIND: "0.0.5003" },
        blocksCount: 3, // genesis + treasury funding + grid storage funding
        transactionsCount: 2,
        totalFeesHbar: 2 * env.simulatedFeeHbar,
        latestHash: c.blockchain.getChain().at(-1)!.hash,
      });
    });

    it("maps transactions to the LedgerTx contract with labels and household ids", async () => {
      const c = buildTestContainer();
      const h = await seedHousehold(c, { type: "consumer", name: "Dar Amel" });
      const account = c.ledger.getHouseholdAccount(h.id);
      c.ledger.transfer("CASHOUT", account.id, null, 4, "cash-out");

      const [cashout, grant] = c.ledger.toLedgerTxs(c.ledger.getHistory(account.id));
      expect(grant).toMatchObject({ type: "WELCOME_GRANT", fromLabel: "Treasury", toLabel: "Dar Amel", householdIds: [h.id], simTime: 6 * 60 }); // day 1, 06:00
      expect(cashout).toMatchObject({ type: "CASHOUT", fromLabel: "Dar Amel", toLabel: "Destroyed", householdIds: [h.id] });
      expect(Object.keys(cashout).sort()).toEqual(
        ["amount", "asset", "blockIndex", "feeHbar", "fromAccountId", "fromLabel", "householdIds", "id", "memo", "simTime", "timestamp", "toAccountId", "toLabel", "type"].sort()
      );

      const [created] = c.ledger.toLedgerTxs(c.ledger.getHistory("0.0.1001").filter((t) => t.fromAccountId === null));
      expect(created).toMatchObject({ fromLabel: "Created", toLabel: "Treasury", householdIds: [] });
    });
  });
});
