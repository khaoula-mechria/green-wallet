import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { createContainer, type Container } from "../../src/container.js";
import { createApp } from "../../src/app.js";

/** Phase 2 endpoints, in the shapes of the frontend contract (frontend/src/types.ts). */
describe("Phase 2 API — settings, shared battery, market status, own offers", () => {
  let app: ReturnType<typeof createApp>;
  let container: Container;
  let token: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    container = createContainer(createInMemoryDatabase());
    app = createApp(container);
    const res = await request(app)
      .post("/api/auth/register")
      .send({ id: "home", name: "Home", type: "prosumer", location: "Tunis", password: "password123", batteryCapacityKwh: 7 });
    expect(res.status).toBe(201);
    token = res.body.data.token;
  });

  it("returns a household in the contract's shape, with its battery", async () => {
    const res = await request(app).get("/api/households/home").set(auth(token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        "accountId", "batteryCapacityKwh", "batteryChargeKwh", "createdAt", "currentConsumption", "currentProduction",
        "energyType", "id", "listableKwh", "location", "name", "reservedInOffersKwh", "reservedTec", "settings",
        "storageSpaceKwh", "storedKwh", "tokenBalance", "type",
      ].sort()
    );
    expect(res.body.data).toMatchObject({ batteryCapacityKwh: 7, batteryChargeKwh: 0, storageSpaceKwh: 10, tokenBalance: 10 });
  });

  it("refuses a battery for a consumer at registration", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ id: "c1", name: "C", type: "consumer", location: "Tunis", password: "password123", batteryCapacityKwh: 5 });
    expect(res.status).toBe(400);
  });

  it("reads and updates the caller's own settings", async () => {
    const get = await request(app).get("/api/households/me/settings").set(auth(token));
    expect(get.body.data.overflowMode).toBe("sell");

    const post = await request(app).post("/api/households/me/settings").set(auth(token)).send({ overflowMode: "store", maxBuyPrice: 0.22 });
    expect(post.status).toBe(200);
    expect(post.body.data).toMatchObject({ overflowMode: "store", maxBuyPrice: 0.22 });

    const bad = await request(app).post("/api/households/me/settings").set(auth(token)).send({ maxBuyPrice: 0.9 });
    expect(bad.status).toBe(400);
    const unknown = await request(app).post("/api/households/me/settings").set(auth(token)).send({ tokenBalance: 1000 });
    expect(unknown.status).toBe(400);
    expect((await request(app).get("/api/households/me/settings")).status).toBe(401);
  });

  it("serves the shared battery and market status publicly", async () => {
    const grid = await request(app).get("/api/grid/status");
    expect(grid.status).toBe(200);
    expect(grid.body.data.gridPool).toMatchObject({ capacityKwh: 40, chargeKwh: 20 });

    const market = await request(app).get("/api/market/status");
    expect(market.status).toBe(200);
    expect(market.body.data).toMatchObject({ simTime: 360, band: { floor: 0.05, ceiling: 0.3 }, lastPrice: null });
  });

  it("records manual readings with their flow and lists the caller's own offers", async () => {
    const reading = await request(app).post("/api/energy/measurements").set(auth(token)).send({ production: 8, consumption: 1 });
    expect(reading.status).toBe(201);
    expect(reading.body.data.settlesInMs).toBe(0);
    expect(reading.body.data.measurement).toMatchObject({ source: "manual", simTime: 360, flow: { toBattery: 7, settled: true } });

    const offer = await request(app).post("/api/market/offers").set(auth(token)).send({ amountKwh: 2, pricePerKwh: 0.2 });
    expect(offer.status).toBe(201);
    const mine = await request(app).get("/api/market/offers/mine").set(auth(token));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ sellerName: "Home", status: "active" });

    const tooCheap = await request(app).post("/api/market/offers").set(auth(token)).send({ amountKwh: 1, pricePerKwh: 0.01 });
    expect(tooCheap.status).toBe(400);
  });

  it("returns the dashboard in the contract's shape, with all five checks passing", async () => {
    await container.measurements.record("home", 5, 1);
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toEqual({ producers: 0, prosumers: 1, consumers: 0 });
    for (const check of ["money", "clearing", "energy", "certificates", "noNegative"]) {
      expect(res.body.data.checks[check].ok, check).toBe(true);
    }
  });
});
