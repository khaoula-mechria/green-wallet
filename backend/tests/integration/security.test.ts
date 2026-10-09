import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { createContainer, type Container } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import { env, validateEnv } from "../../src/config/env.js";
import { attachWebSocketServer } from "../../src/ws/websocketServer.js";

function buildApp() {
  const container = createContainer(createInMemoryDatabase());
  return { app: createApp(container), container };
}

async function register(app: ReturnType<typeof createApp>, id: string, type = "producer") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ id, name: id, type, location: "Tunis", password: "password123" });
  expect(res.status).toBe(201);
  return res.body.data.token as string;
}

describe("Phase 0 — registration cannot set balances", () => {
  let app: ReturnType<typeof createApp>;
  let container: Container;
  beforeEach(() => ({ app, container } = buildApp()));

  it("rejects a client-supplied initialTokenBalance and creates no household", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ id: "rich", name: "Rich", type: "consumer", password: "password123", initialTokenBalance: 1_000_000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(() => container.households.getById("rich")).toThrow();
  });

  it("applies the server-side signup grant to consumers only", async () => {
    const consumer = await register(app, "new-consumer", "consumer");
    const producer = await register(app, "new-producer", "producer");
    const consumerBalance = container.tokens.getBalance("new-consumer");
    const producerBalance = container.tokens.getBalance("new-producer");
    expect(consumerBalance).toBeCloseTo(env.welcomeGrantTec ?? 10, 2);
    expect(producerBalance).toBe(0);
  });

  it("rejects malformed household ids", async () => {
    for (const id of ["", "-leading-dash", "../etc", "has space", "x".repeat(65)]) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ id, name: "Bad", type: "producer", password: "password123" });
      expect(res.status, id).toBe(400);
    }
  });

  it("answers malformed JSON with 400, not 500", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
  });
});

describe("Phase 0 — manual meter readings are bounded", () => {
  let app: ReturnType<typeof createApp>;
  let container: Container;
  let token: string;
  beforeEach(async () => {
    ({ app, container } = buildApp());
    token = await register(app, "meter-1");
  });
  afterEach(() => {
    env.manualMeasurementsEnabled = true;
  });

  const submit = (body: object) =>
    request(app).post("/api/energy/measurements").set("Authorization", `Bearer ${token}`).send(body);

  it("rejects readings above the per-reading cap, so production can't issue unbounded certificates", async () => {
    const res = await submit({ production: 1e12, consumption: 0 });
    expect(res.status).toBe(400);
    expect(container.tokens.wallet("meter-1").certificates).toEqual({ solar: 0, wind: 0 });
    expect(container.tokens.getBalance("meter-1")).toBe(0); // producer, no grant
  });

  it("allows one reading per household per interval, and a rejected reading doesn't use the slot", async () => {
    expect((await submit({ production: 1e12, consumption: 0 })).status).toBe(400);
    expect((await submit({ production: 8, consumption: 3 })).status).toBe(201);
    const second = await submit({ production: 8, consumption: 3 });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("TOO_MANY_REQUESTS");
    // One accepted reading: 8 kWh certified, 3 used on the spot, 5 waiting for the auction
    // (still backed by their certificates). Production earns no TEC.
    expect(container.tokens.wallet("meter-1").certificates).toEqual({ solar: 5, wind: 0 });
    expect(container.tokens.getBalance("meter-1")).toBe(0);
  });

  it("can be switched off entirely (production default)", async () => {
    env.manualMeasurementsEnabled = false;
    const res = await submit({ production: 8, consumption: 3 });
    expect(res.status).toBe(403);
  });
});

describe("Phase 0 — private data is owner-only", () => {
  let app: ReturnType<typeof createApp>;
  let container: Container;
  let aliceToken: string;
  let bobToken: string;
  let eveToken: string;
  let tradeId: string;

  beforeEach(async () => {
    ({ app, container } = buildApp());
    aliceToken = await register(app, "alice", "prosumer"); // 10 kWh battery by default
    bobToken = await register(app, "bob", "consumer");
    eveToken = await register(app, "eve", "consumer");
    await container.measurements.record("alice", 8, 3); // 5 kWh in the battery, 3 listable
    const offer = container.marketplace.createOffer("alice", 3, 0.2);
    tradeId = (await container.trades.purchase("bob", offer.id, 2)).id;
  });

  const get = (path: string, token?: string) => {
    const r = request(app).get(`/api${path}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };

  it("requires a token for wallets, trades, meter history, and the household list", async () => {
    for (const path of ["/tokens/balance/bob", "/tokens/history/bob", "/trades", "/households", "/households/bob/history", "/microgrid", "/energy/measurements"]) {
      expect((await get(path)).status, path).toBe(401);
    }
  });

  it("allows public access to transaction feed", async () => {
    const res = await get("/transactions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
  });

  it("forbids reading another household's wallet, trades or meter history", async () => {
    for (const path of ["/tokens/balance/bob", "/tokens/history/bob", "/trades?householdId=bob", "/households/bob/history"]) {
      expect((await get(path, eveToken)).status, path).toBe(403);
    }
    expect((await get(`/trades/${tradeId}`, eveToken)).status).toBe(404);
  });

  it("still lets each household read its own data, and both trade parties see the trade", async () => {
    expect((await get("/tokens/history/bob", bobToken)).status).toBe(200);
    expect((await get("/households/alice/history", aliceToken)).status).toBe(200);
    const trades = await get("/trades", bobToken);
    expect(trades.body.data.map((t: { id: string }) => t.id)).toEqual([tradeId]);
    expect((await get(`/trades/${tradeId}`, aliceToken)).status).toBe(200);
    expect((await get(`/trades/${tradeId}`, bobToken)).status).toBe(200);
  });

  it("lists only the caller's own meter readings", async () => {
    const res = await get("/energy/measurements", aliceToken);
    expect(res.status).toBe(200);
    expect(res.body.data.every((m: { householdId: string }) => m.householdId === "alice")).toBe(true);
    expect((await get("/energy/measurements", eveToken)).body.data).toEqual([]);
  });

  it("keeps the public views public", async () => {
    for (const path of ["/dashboard", "/market/offers", "/blockchain/status", "/blockchain/blocks"]) {
      expect((await get(path)).status, path).toBe(200);
    }
  });
});

describe("Rate limits fit a polling frontend", () => {
  it("lets an open page poll freely: 300 reads in a minute are all served", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 300; i++) {
      const res = await request(app).get("/api/market/status");
      expect(res.status, `read #${i + 1}`).toBe(200);
    }
  });

  it("still limits writes: the 121st login attempt in a minute is refused", async () => {
    const { app } = buildApp();
    const attempt = () => request(app).post("/api/auth/login").send({ id: "nobody", password: "wrong" });
    for (let i = 0; i < 120; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
  });
});

describe("Phase 0 — WebSocket notifications are authenticated", () => {
  let server: Server;
  let container: Container;
  let app: ReturnType<typeof createApp>;
  let base: string;

  beforeEach(async () => {
    ({ app, container } = buildApp());
    server = createServer(app);
    attachWebSocketServer(server, container.notifications);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** Resolves with the HTTP status of a rejected upgrade, or "open". */
  const connect = (url: string) =>
    new Promise<{ outcome: number | "open"; ws: WebSocket }>((resolve) => {
      const ws = new WebSocket(url);
      ws.on("open", () => resolve({ outcome: "open", ws }));
      ws.on("unexpected-response", (_req, res) => resolve({ outcome: res.statusCode ?? 0, ws }));
    });

  it("rejects connections without a valid token", async () => {
    expect((await connect(base)).outcome).toBe(401);
    expect((await connect(`${base}?token=forged`)).outcome).toBe(401);
    // The old unauthenticated form must no longer work.
    expect((await connect(`${base}?householdId=alice`)).outcome).toBe(401);
  });

  it("delivers a household's notifications only to that household's own socket", async () => {
    const aliceToken = await register(app, "alice");
    const eveToken = await register(app, "eve");
    const alice = await connect(`${base}?token=${aliceToken}`);
    const eve = await connect(`${base}?token=${eveToken}`);
    expect(alice.outcome).toBe("open");
    expect(eve.outcome).toBe("open");

    const eveMessages: string[] = [];
    eve.ws.on("message", (m) => eveMessages.push(m.toString()));
    const aliceMessage = new Promise<string>((resolve) => alice.ws.once("message", (m) => resolve(m.toString())));

    container.notifications.notify("alice", "TRADE_COMPLETED", { id: "t1" });
    expect(JSON.parse(await aliceMessage).type).toBe("TRADE_COMPLETED");
    expect(eveMessages).toEqual([]);

    alice.ws.close();
    eve.ws.close();
  });
});

describe("Phase 0 — production configuration is validated", () => {
  const strong = (c: string) => c.repeat(40);
  // In production OPERATOR_PASSWORD defaults to empty: the operator console stays closed.
  const prod = { ...env, isProduction: true, corsOrigin: false as const, jwtSecret: strong("a"), keyEncryptionSecret: strong("b"), operatorPassword: "" };

  it("accepts a properly configured production environment", () => {
    expect(validateEnv(prod)).toEqual([]);
  });

  it("refuses a short operator-console password in production", () => {
    expect(validateEnv({ ...prod, operatorPassword: "operator123" }).join()).toMatch(/OPERATOR_PASSWORD/);
    expect(validateEnv({ ...prod, operatorPassword: strong("c") })).toEqual([]);
  });

  it("refuses placeholder, short or shared secrets and wildcard CORS", () => {
    expect(validateEnv({ ...prod, jwtSecret: "dev-insecure-secret-change-me" }).join()).toMatch(/JWT_SECRET/);
    expect(validateEnv({ ...prod, keyEncryptionSecret: "replace-with-a-long-random-string" }).join()).toMatch(/KEY_ENCRYPTION_SECRET/);
    expect(validateEnv({ ...prod, jwtSecret: "short" }).join()).toMatch(/at least 32/);
    expect(validateEnv({ ...prod, keyEncryptionSecret: prod.jwtSecret }).join()).toMatch(/must differ/);
    expect(validateEnv({ ...prod, corsOrigin: "*" }).join()).toMatch(/CORS_ORIGIN/);
  });

  it("does not enforce production secrets in development", () => {
    expect(validateEnv({ ...env, isProduction: false, jwtSecret: "dev-insecure-secret-change-me" })).toEqual([]);
  });

  it("rejects invalid numeric settings everywhere", () => {
    expect(validateEnv({ ...env, isProduction: false, port: Number("abc") }).join()).toMatch(/PORT/);
  });
});

describe("operator console login", () => {
  let app: ReturnType<typeof buildApp>["app"];
  beforeEach(() => ({ app } = buildApp()));

  it("issues a token for the operator password and refuses a wrong one", async () => {
    const ok = await request(app).post("/api/auth/operator-login").send({ password: env.operatorPassword });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.data.token).toBe("string");

    const bad = await request(app).post("/api/auth/operator-login").send({ password: "nope" });
    expect(bad.status).toBe(401);
  });

  it("never lets the operator token read a household's private data", async () => {
    await request(app).post("/api/auth/register").send({ id: "home-1", name: "Home", type: "consumer", password: "secret123" });
    const { body } = await request(app).post("/api/auth/operator-login").send({ password: env.operatorPassword });
    const wallet = await request(app).get("/api/wallet/home-1").set("Authorization", `Bearer ${body.data.token}`);
    expect(wallet.status).toBe(403);
  });
});

describe("operator console actions", () => {
  let app: ReturnType<typeof buildApp>["app"];
  let container: Container;
  beforeEach(() => ({ app, container } = buildApp()));

  const operatorToken = async () =>
    (await request(app).post("/api/auth/operator-login").send({ password: env.operatorPassword })).body.data.token as string;

  it("lets the operator add a household and credit it from the treasury", async () => {
    const token = await operatorToken();
    const created = await request(app)
      .post("/api/admin/households")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "new-home", name: "New Home", type: "prosumer", password: "secret123", batteryCapacityKwh: 6 });
    expect(created.status).toBe(201);
    expect(created.body.data.type).toBe("prosumer");
    expect(created.body.data.batteryCapacityKwh).toBe(6);

    const before = container.ledger.checkMoneyInvariant().totalSupply;
    const credited = await request(app).post("/api/admin/households/new-home/credit").set("Authorization", `Bearer ${token}`).send({ amount: 25 });
    expect(credited.status).toBe(200);
    expect(credited.body.data.tokenBalance).toBe(env.welcomeGrantTec + 25);
    expect(container.ledger.checkMoneyInvariant().totalSupply).toBe(before); // moved from the treasury, not created
  });

  it("refuses household tokens and anonymous calls", async () => {
    const home = await request(app).post("/api/auth/register").send({ id: "home-2", name: "Home", type: "consumer", password: "secret123" });
    const asHousehold = await request(app)
      .post("/api/admin/households")
      .set("Authorization", `Bearer ${home.body.data.token}`)
      .send({ name: "X", type: "consumer", password: "secret123" });
    expect(asHousehold.status).toBe(403);
    const anonymous = await request(app).post("/api/admin/households/home-2/credit").send({ amount: 5 });
    expect(anonymous.status).toBe(401);
  });
});
