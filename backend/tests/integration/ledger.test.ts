import { describe, it, expect } from "vitest";
import request from "supertest";
import Database from "better-sqlite3";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { runMigrations, LATEST_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { createContainer, type Container } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import { LocalBlockchainService } from "../../src/blockchain/LocalBlockchainService.js";
import type { ChainTransactionInput } from "../../src/blockchain/BlockchainService.js";
import { computeBlockHash } from "../../src/blockchain/hash.js";
import { BlockchainRepository } from "../../src/db/repositories/blockchainRepository.js";
import { tradeTotalMicro } from "../../src/domain/units.js";
import { seedHousehold } from "../testContainer.js";

/** Local ledger whose `append` can be made to fail on demand — simulates a
 * crash / error midway through a money movement. */
class FaultyLedger extends LocalBlockchainService {
  failNext = false;
  override append(input: ChainTransactionInput) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("injected ledger failure");
    }
    return super.append(input);
  }
}

function build(): { c: Container; ledger: FaultyLedger } {
  const db = createInMemoryDatabase();
  const ledger = new FaultyLedger(db);
  return { c: createContainer(db, ledger), ledger };
}

async function producerWithOffer(c: Container, amountKwh: number, price: number, id = "seller") {
  await seedHousehold(c, { id, type: "producer" });
  await c.measurements.record(id, 10, 0); // 10 kWh surplus
  return c.marketplace.createOffer(id, amountKwh, price);
}

const count = (c: Container, table: string) => (c.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("Phase 1 — balances can't be overdrawn", () => {
  it("lets only one of two concurrent purchases through when the buyer can afford just one", async () => {
    const { c } = build();
    const a = await producerWithOffer(c, 5, 1, "seller-a");
    const b = await producerWithOffer(c, 5, 1, "seller-b");
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 4 });

    const results = await Promise.allSettled([c.trades.purchase("buyer", a.id, 3), c.trades.purchase("buyer", b.id, 3)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(c.tokens.getBalance("buyer")).toBe(1);
    expect(c.ledger.reconcile().ok).toBe(true);
  });

  it("is enforced by the database itself: negative or fractional balances are rejected", async () => {
    const { c } = build();
    await seedHousehold(c, { id: "h", initialTokenBalance: 1 });
    expect(() => c.db.prepare(`UPDATE households SET tokenBalanceMicro = -1 WHERE id = 'h'`).run()).toThrow(/CHECK/);
    expect(() => c.db.prepare(`UPDATE households SET tokenBalanceMicro = 1.5 WHERE id = 'h'`).run()).toThrow(/CHECK/);
    expect(() => c.db.prepare(`UPDATE households SET energyBalanceWh = -1 WHERE id = 'h'`).run()).toThrow(/CHECK/);
  });
});

describe("Phase 1 — money movements are atomic with their ledger record", () => {
  it("rolls back a purchase completely if the ledger write fails midway", async () => {
    const { c, ledger } = build();
    const offer = await producerWithOffer(c, 3, 0.5);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 10 });
    const before = { trades: count(c, "energy_trades"), tokenTx: count(c, "token_transactions"), blocks: count(c, "blockchain_blocks") };

    ledger.failNext = true;
    await expect(c.trades.purchase("buyer", offer.id, 2)).rejects.toThrow(/injected/);

    expect(c.tokens.getBalance("buyer")).toBe(10);
    expect(c.tokens.getBalance("seller")).toBe(10);
    expect(c.households.getById("buyer").energyBalance).toBe(0);
    expect(c.marketplace.getOffer(offer.id).amountRemainingKwh).toBe(3);
    expect({ trades: count(c, "energy_trades"), tokenTx: count(c, "token_transactions"), blocks: count(c, "blockchain_blocks") }).toEqual(before);
    expect(c.ledger.reconcile().ok).toBe(true);
  });

  it("never stores a meter reading without its mint (or the reverse)", async () => {
    const { c, ledger } = build();
    await seedHousehold(c, { id: "p" });
    ledger.failNext = true;
    await expect(c.measurements.record("p", 8, 3)).rejects.toThrow(/injected/);
    expect(count(c, "energy_measurements")).toBe(0);
    expect(c.households.getById("p").tokenBalance).toBe(0);
    expect(c.households.getById("p").currentProduction).toBe(0);
  });

  it("never creates a household without its starting grant", async () => {
    const { c, ledger } = build();
    ledger.failNext = true;
    await expect(seedHousehold(c, { id: "h", initialTokenBalance: 5 })).rejects.toThrow(/injected/);
    expect(count(c, "households")).toBe(0);
  });
});

describe("Phase 1 — exact integer arithmetic", () => {
  it("rounds trade totals half-up to the nearest µTEC", () => {
    expect(tradeTotalMicro(100_000, 300)).toBe(30_000); // 0.1 TEC/kWh × 0.3 kWh = 0.03 TEC
    expect(tradeTotalMicro(1, 500)).toBe(1); // 0.0005 µTEC rounds up
    expect(tradeTotalMicro(1, 499)).toBe(0);
    // The intermediate product (≈1.2e16) exceeds float precision; the result is still exact.
    expect(tradeTotalMicro(123_456_789_123, 99_999)).toBe(12_345_555_455_511);
    expect(() => tradeTotalMicro(1_000_000_000_000, 1_000_000_000)).toThrow(/out of range/);
  });

  it("keeps many small trades exact: supply is conserved to the µTEC", async () => {
    const { c } = build();
    const offer = await producerWithOffer(c, 3, 0.1);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 1 });

    for (let i = 0; i < 30; i++) await c.trades.purchase("buyer", offer.id, 0.1);

    expect(c.tokens.getBalance("buyer")).toBe(0.7); // 1 − 30 × 0.01, exactly
    expect(c.tokens.getBalance("seller")).toBe(10.3);
    expect(c.households.getById("buyer").energyBalance).toBe(3);
    expect(c.marketplace.getOffer(offer.id).status).toBe("completed");
    const { ok, supply } = c.ledger.reconcile();
    expect(ok).toBe(true);
    expect(supply.balancesMicro).toBe(supply.issuedMicro);
  });

  it("rejects a purchase so small it would be free", async () => {
    const { c } = build();
    const offer = await producerWithOffer(c, 1, 0.000001);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 1 });
    await expect(c.trades.purchase("buyer", offer.id, 0.001)).rejects.toThrow(/too small to price/);
  });
});

describe("Phase 1 — idempotent purchases", () => {
  it("returns the original trade when a purchase is retried with the same key", async () => {
    const { c } = build();
    const offer = await producerWithOffer(c, 5, 1);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 10 });

    const first = await c.trades.purchase("buyer", offer.id, 2, "key-12345678");
    const retry = await c.trades.purchase("buyer", offer.id, 2, "key-12345678");

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.trade.id).toBe(first.trade.id);
    expect(c.tokens.getBalance("buyer")).toBe(8); // charged once
    await expect(c.trades.purchase("buyer", offer.id, 3, "key-12345678")).rejects.toThrow(/different purchase/);
  });

  it("replays over HTTP with 200 and an Idempotent-Replayed header", async () => {
    const { c } = build();
    const app = createApp(c);
    const offer = await producerWithOffer(c, 5, 1);
    const reg = await request(app).post("/api/auth/register").send({ id: "buyer", name: "Buyer", type: "consumer", password: "password123" });
    const buy = () =>
      request(app)
        .post(`/api/market/offers/${offer.id}/purchase`)
        .set("Authorization", `Bearer ${reg.body.data.token}`)
        .set("Idempotency-Key", "checkout-abc-123")
        .send({ amountKwh: 1 });

    const first = await buy();
    const second = await buy();
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.data.id).toBe(first.body.data.id);
  });
});

describe("Phase 1 — tamper detection and reconciliation", () => {
  async function tradedContainer() {
    const { c } = build();
    const offer = await producerWithOffer(c, 3, 0.5);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 10 });
    const { trade } = await c.trades.purchase("buyer", offer.id, 2);
    return { c, trade };
  }

  it("reports a clean ledger as valid", async () => {
    const { c } = await tradedContainer();
    const { chain, reconciliation } = c.ledger.checkIntegrity();
    expect(chain.valid).toBe(true);
    expect(chain.legacyBlocks).toBe(0);
    expect(reconciliation.ok).toBe(true);
  });

  it("detects an amount edited directly in the ledger table", async () => {
    const { c, trade } = await tradedContainer();
    c.db.prepare(`UPDATE blockchain_transactions SET amountMicro = 999000000 WHERE id = ?`).run(trade.blockchainTxId);

    const { chain, reconciliation } = c.ledger.checkIntegrity();
    expect(chain.valid).toBe(false);
    expect(chain.errors[0].reason).toMatch(/transaction was altered/);
    expect(reconciliation.ledgerMismatches).toEqual([{ tokenTxId: trade.blockchainTxId, reason: "amount differs from ledger" }]);
  });

  it("detects a balance edited without a matching transaction", async () => {
    const { c } = await tradedContainer();
    c.db.prepare(`UPDATE households SET tokenBalanceMicro = tokenBalanceMicro + 1 WHERE id = 'buyer'`).run();
    const report = c.ledger.reconcile();
    expect(report.ok).toBe(false);
    expect(report.balanceMismatches.map((m) => m.householdId)).toEqual(["buyer"]);
  });

  it("exposes chain verification publicly at /api/blockchain/verify", async () => {
    const { c } = await tradedContainer();
    const res = await request(createApp(c)).get("/api/blockchain/verify");
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });
});

describe("Phase 1 — stale pending trades are released", () => {
  it("returns reserved capacity to the offer and blocks later execution", async () => {
    const { c } = build();
    const offer = await producerWithOffer(c, 3, 0.5);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 10 });

    const pending = c.trades.createTrade("buyer", offer.id, 3);
    expect(c.marketplace.getOffer(offer.id).status).toBe("completed"); // fully reserved

    expect(c.trades.releaseStalePending(0)).toBe(1);
    expect(c.trades.getById(pending.id).status).toBe("failed");
    expect(c.marketplace.getOffer(offer.id)).toMatchObject({ status: "active", amountRemainingKwh: 3 });
    await expect(c.trades.executeTrade(pending.id)).rejects.toThrow(/already failed/);
  });

  it("refunds the seller directly if the offer was cancelled in the meantime", async () => {
    const { c } = build();
    const offer = await producerWithOffer(c, 3, 0.5);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 10 });

    c.trades.createTrade("buyer", offer.id, 1);
    c.marketplace.cancelOffer("seller", offer.id); // refunds the 2 unreserved kWh
    expect(c.households.getById("seller").energyBalance).toBe(9);

    c.trades.releaseStalePending(0);
    expect(c.households.getById("seller").energyBalance).toBe(10); // no energy lost
    expect(c.marketplace.getOffer(offer.id).status).toBe("cancelled");
  });

  it("leaves recent pending trades alone", async () => {
    const { c } = build();
    const offer = await producerWithOffer(c, 3, 0.5);
    await seedHousehold(c, { id: "buyer", type: "consumer", initialTokenBalance: 10 });
    c.trades.createTrade("buyer", offer.id, 1);
    expect(c.trades.releaseStalePending(60_000)).toBe(0);
  });
});

describe("Phase 1 — external anchoring retries", () => {
  it("retries a failed anchor and gives up after the configured attempts", async () => {
    const db = createInMemoryDatabase();
    const pendingLedger = new LocalBlockchainService(db, "pending");
    pendingLedger.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h", amountMicro: 1, payload: {} });
    const repo = new BlockchainRepository(db);

    expect(repo.anchorCounts().pending).toBe(1);
    expect(repo.recordAnchorFailure("tx-1", "network down", 3)).toBe("pending");
    expect(repo.recordAnchorFailure("tx-1", "network down", 3)).toBe("pending");
    expect(repo.recordAnchorFailure("tx-1", "network down", 3)).toBe("failed");
    expect(repo.findTransactionById("tx-1")).toMatchObject({ anchorAttempts: 3, anchorError: "network down" });
    expect(repo.findPendingAnchors(10)).toHaveLength(0);
  });
});

describe("Phase 1 — migrating a legacy (float) database", () => {
  function legacyDatabase() {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db, () => {}, 1); // the original schema
    const t = 1_700_000_000_000;
    const ins = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args);
    ins(`INSERT INTO households VALUES ('producer-1','P','producer','Tunis','x',NULL,NULL,'solar',8,3,2,5.6,?,?)`, t, t);
    ins(`INSERT INTO households VALUES ('consumer-1','C','consumer','Tunis','x',NULL,NULL,'grid',0,4,3,49.400000000000006,?,?)`, t, t);
    ins(`INSERT INTO energy_measurements VALUES ('m1','producer-1',?,8,3,5)`, t);
    ins(`INSERT INTO energy_offers VALUES ('o1','producer-1',3,0,0.2,'completed',?,?)`, t, t);
    ins(`INSERT INTO energy_trades VALUES ('tr1','o1','producer-1','consumer-1',3,0.2,0.6000000000000001,'completed','tx-trade',?,?)`, t, t);
    ins(`INSERT INTO token_transactions VALUES ('tx-mint','MINT',NULL,'producer-1',5,?,'tx-mint',NULL)`, t);
    ins(`INSERT INTO token_transactions VALUES ('tx-trade','TRADE_SETTLEMENT','consumer-1','producer-1',0.6000000000000001,?,'tx-trade','tr1')`, t);
    ins(`INSERT INTO blockchain_transactions VALUES ('tx-mint','MINT',NULL,'producer-1',5,?,1,NULL,'{}')`, t);
    ins(`INSERT INTO blockchain_transactions VALUES ('tx-trade','TRADE','consumer-1','producer-1',0.6000000000000001,?,2,NULL,'{}')`, t);
    // Legacy v1 blocks: hash over transaction ids only, with proof-of-work.
    let prev = "0".repeat(64);
    [[], ["tx-mint"], ["tx-trade"]].forEach((ids, index) => {
      const header = { index, timestamp: t, previousHash: prev, transactionIds: ids, hashVersion: 1 as const };
      let nonce = 0;
      let hash = computeBlockHash({ ...header, nonce });
      while (index > 0 && !hash.startsWith("00")) hash = computeBlockHash({ ...header, nonce: ++nonce });
      ins(`INSERT INTO blockchain_blocks VALUES (?,?,?,?,?,?)`, index, t, prev, hash, nonce, JSON.stringify(ids));
      prev = hash;
    });
    return db;
  }

  it("converts every amount to exact integer units and keeps the ledger verifiable", () => {
    const db = legacyDatabase();
    runMigrations(db);

    const version = (db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number }).v;
    expect(version).toBe(LATEST_SCHEMA_VERSION);
    const bal = (id: string) => db.prepare(`SELECT tokenBalanceMicro AS t, energyBalanceWh AS e FROM households WHERE id = ?`).get(id);
    expect(bal("consumer-1")).toEqual({ t: 49_400_000, e: 3_000 });
    expect(bal("producer-1")).toEqual({ t: 5_600_000, e: 2_000 });
    expect(db.prepare(`SELECT totalPriceMicro FROM energy_trades`).get()).toEqual({ totalPriceMicro: 600_000 });

    const c = createContainer(db);
    // consumer-1's seeded 50 TEC predates GRANT records: it gets an opening balance.
    expect(c.tokens.getHistory("consumer-1").find((t) => t.type === "GRANT")?.amount).toBe(50);

    const { chain, reconciliation } = c.ledger.checkIntegrity();
    expect(reconciliation.ok).toBe(true);
    expect(chain.valid).toBe(true);
    expect(chain.legacyBlocks).toBe(3);

    // New activity on the migrated database uses v2 (content-committing) blocks.
    return c.tokens.transfer("consumer-1", "producer-1", 1).then(() => {
      expect(c.blockchain.getChain().at(-1)!.hashVersion).toBe(2);
      expect(c.ledger.checkIntegrity().chain.valid).toBe(true);
    });
  });

  it("refuses to migrate data that breaks an invariant, leaving the old schema untouched", () => {
    const db = legacyDatabase();
    db.prepare(`UPDATE households SET tokenBalance = -0.5 WHERE id = 'consumer-1'`).run();
    expect(() => runMigrations(db)).toThrow(/CHECK/);
    expect((db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number }).v).toBe(1);
    expect(db.prepare(`SELECT tokenBalance FROM households WHERE id = 'consumer-1'`).get()).toEqual({ tokenBalance: -0.5 });
  });
});
