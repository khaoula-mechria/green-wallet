import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { createContainer, type Container } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";

describe("Wallet API — top-up, cash-out, owner-only access", () => {
  let app: ReturnType<typeof createApp>;
  let container: Container;
  let aliceToken: string;
  let bobToken: string;

  const register = async (id: string, type: string) => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ id, name: id, type, location: "Tunis", password: "password123" });
    expect(res.status).toBe(201);
    return res.body.data.token as string;
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    container = createContainer(createInMemoryDatabase());
    app = createApp(container);
    aliceToken = await register("alice", "consumer");
    bobToken = await register("bob", "consumer");
  });
  afterEach(() => {
    env.topupsEnabled = true;
  });

  it("requires a token for every wallet route", async () => {
    expect((await request(app).get("/api/wallet/alice")).status).toBe(401);
    expect((await request(app).post("/api/wallet/topup").send({ amount: 5 })).status).toBe(401);
    expect((await request(app).post("/api/wallet/cashout").send({ amount: 5 })).status).toBe(401);
  });

  it("returns the owner's wallet and forbids reading someone else's", async () => {
    const own = await request(app).get("/api/wallet/alice").set(auth(aliceToken));
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({
      householdId: "alice",
      accountId: "0.0.4801",
      tokenBalance: env.welcomeGrantTec,
      reservedTec: 0,
      availableTec: env.welcomeGrantTec,
      topupsEnabled: true,
      topupMaxTec: env.topupMaxTec,
    });

    expect((await request(app).get("/api/wallet/alice").set(auth(bobToken))).status).toBe(403);
  });

  it("tops up the caller's own wallet, never another household's", async () => {
    const res = await request(app).post("/api/wallet/topup").set(auth(aliceToken)).send({ amount: 25 });
    expect(res.status).toBe(200);
    expect(res.body.data.tokenBalance).toBe(env.welcomeGrantTec + 25);
    expect(container.tokens.getBalance("bob")).toBe(env.welcomeGrantTec);

    const extraField = await request(app).post("/api/wallet/topup").set(auth(aliceToken)).send({ amount: 5, householdId: "bob" });
    expect(extraField.status).toBe(400);
  });

  it("enforces the per-top-up cap and the cooldown", async () => {
    const tooBig = await request(app).post("/api/wallet/topup").set(auth(aliceToken)).send({ amount: env.topupMaxTec + 1 });
    expect(tooBig.status).toBe(400);

    expect((await request(app).post("/api/wallet/topup").set(auth(aliceToken)).send({ amount: 10 })).status).toBe(200);
    const again = await request(app).post("/api/wallet/topup").set(auth(aliceToken)).send({ amount: 10 });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/wait/i);
    expect(container.tokens.getBalance("alice")).toBe(env.welcomeGrantTec + 10);
  });

  it("refuses top-ups and cash-outs when the feature is switched off", async () => {
    env.topupsEnabled = false;
    expect((await request(app).post("/api/wallet/topup").set(auth(aliceToken)).send({ amount: 10 })).status).toBe(400);
    expect((await request(app).post("/api/wallet/cashout").set(auth(aliceToken)).send({ amount: 1 })).status).toBe(400);
    expect(container.tokens.getBalance("alice")).toBe(env.welcomeGrantTec);
  });

  it("cashes out only what is available, and destroys the TEC", async () => {
    const over = await request(app).post("/api/wallet/cashout").set(auth(aliceToken)).send({ amount: env.welcomeGrantTec + 1 });
    expect(over.status).toBe(400);

    const ok = await request(app).post("/api/wallet/cashout").set(auth(aliceToken)).send({ amount: 4 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.tokenBalance).toBe(env.welcomeGrantTec - 4);

    const invariant = container.ledger.checkMoneyInvariant();
    expect(invariant.ok).toBe(true);
    expect(invariant.totalSupply).toBe(env.treasuryInitialTec - 4);
  });
});

describe("Ledger API — contract shapes", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    app = createApp(createContainer(createInMemoryDatabase()));
    const res = await request(app)
      .post("/api/auth/register")
      .send({ id: "carol", name: "Carol", type: "consumer", location: "Tunis", password: "password123" });
    token = res.body.data.token;
  });

  it("exposes accountId and TEC balance on households", async () => {
    const res = await request(app).get("/api/households/carol").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ accountId: "0.0.4801", tokenBalance: env.welcomeGrantTec, reservedTec: 0 });
    expect(res.body.data).not.toHaveProperty("passwordHash");
  });

  it("returns LedgerTx objects from the history, the public feed and block details", async () => {
    const history = await request(app).get("/api/tokens/history/carol").set("Authorization", `Bearer ${token}`);
    expect(history.body.data).toEqual([
      expect.objectContaining({ type: "WELCOME_GRANT", fromLabel: "Treasury", toLabel: "Carol", householdIds: ["carol"] }),
    ]);

    const feed = await request(app).get("/api/transactions?asset=TEC&limit=2");
    expect(feed.status).toBe(200);
    expect(feed.body.data).toHaveLength(2);
    expect(feed.body.data[0]).toMatchObject({ type: "WELCOME_GRANT", toLabel: "Carol" });

    const block = await request(app).get(`/api/blockchain/blocks/${feed.body.data[0].blockIndex}`);
    expect(block.status).toBe(200);
    expect(block.body.data.transactions).toEqual([feed.body.data[0]]);
  });

  it("rejects an unknown asset filter and tolerates a malformed limit", async () => {
    expect((await request(app).get("/api/transactions?asset=DOGE")).status).toBe(400);
    expect((await request(app).get("/api/transactions?limit=abc")).status).toBe(200);
  });
});
