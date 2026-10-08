import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { createContainer, type Container } from "../../src/container.js";
import { createApp } from "../../src/app.js";

/** Phase 3 endpoints, in the shapes of the frontend contract (frontend/src/types.ts). */
describe("Phase 3 API — price history, latest auction, my bid", () => {
  let app: ReturnType<typeof createApp>;
  let container: Container;
  let farmToken: string;
  let homeToken: string;

  const register = async (id: string, type: string) => {
    const res = await request(app).post("/api/auth/register").send({ id, name: id, type, location: "Tunis", password: "password123" });
    expect(res.status).toBe(201);
    return res.body.data.token as string;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    container = createContainer(createInMemoryDatabase());
    app = createApp(container);
    farmToken = await register("farm", "producer");
    homeToken = await register("home", "consumer");
  });

  it("starts with no auction and no price", async () => {
    expect((await request(app).get("/api/market/auctions/latest")).body.data).toBeNull();
    expect((await request(app).get("/api/market/price-history")).body.data).toEqual([]);
    expect((await request(app).get("/api/market/status")).body.data).toMatchObject({ lastPrice: null, avg24h: 0.175 });
  });

  it("shows the caller's automatic bid while the interval is open", async () => {
    await request(app).post("/api/energy/measurements").set(auth(homeToken)).send({ production: 0, consumption: 3 });

    const res = await request(app).get("/api/market/my-bid").set(auth(homeToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      side: "buy",
      bids: [{ source: "deficit", quantity: 3, limitPrice: 0.3 }],
      pendingSellKwh: 0,
      pendingBuyKwh: 3,
      reservedTec: 0.9,
      optedOut: false,
    });
    expect((await request(app).get("/api/market/my-bid")).status).toBe(401);
  });

  it("publishes the settled auction and its price history", async () => {
    await request(app).post("/api/energy/measurements").set(auth(farmToken)).send({ production: 6, consumption: 0 });
    await request(app).post("/api/energy/measurements").set(auth(homeToken)).send({ production: 0, consumption: 3 });
    container.market.endInterval();

    const latest = (await request(app).get("/api/market/auctions/latest")).body.data;
    expect(Object.keys(latest).sort()).toEqual(
      ["bids", "clearingPrice", "exportedKwh", "importedKwh", "interval", "lastMatchedBuyPrice", "lastMatchedSellPrice", "simTime", "volume"].sort()
    );
    expect(latest.clearingPrice).toBeGreaterThan(0.05);
    expect(latest.bids.map((b: { participantId: string; side: string }) => `${b.participantId}:${b.side}`).sort()).toEqual(
      ["farm:sell", "grid-pool:buy", "grid-pool:sell", "home:buy"].sort()
    );

    const history = (await request(app).get("/api/market/price-history?limit=10")).body.data;
    expect(history).toEqual([
      { interval: 0, simTime: 360, price: latest.clearingPrice, volume: latest.volume, exportedKwh: 0, importedKwh: 0, avg24h: latest.clearingPrice },
    ]);
    expect((await request(app).get("/api/market/status")).body.data).toMatchObject({ lastPrice: latest.clearingPrice, interval: 1, simTime: 390 });

    const dashboard = (await request(app).get("/api/dashboard")).body.data;
    expect(dashboard.lastPrice).toBe(latest.clearingPrice);
    expect(dashboard.checks.clearing).toEqual({ ok: true, balance: 0 });
  });
});
