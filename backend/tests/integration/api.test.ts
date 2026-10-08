import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";

function buildApp() {
  const db = createInMemoryDatabase();
  const container = createContainer(db);
  return { app: createApp(container), container };
}

describe("API integration", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  it("registers and logs in a household, and rejects a duplicate id", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ id: "h1", name: "Test", type: "producer", location: "Tunis", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();

    const dup = await request(app)
      .post("/api/auth/register")
      .send({ id: "h1", name: "Test", type: "producer", location: "Tunis", password: "password123" });
    expect(dup.status).toBe(409);

    const login = await request(app).post("/api/auth/login").send({ id: "h1", password: "password123" });
    expect(login.status).toBe(200);

    const badLogin = await request(app).post("/api/auth/login").send({ id: "h1", password: "wrong" });
    expect(badLogin.status).toBe(401);
  });

  it("rejects mutating requests without a bearer token", async () => {
    const res = await request(app).post("/api/market/offers").send({ amountKwh: 1, pricePerKwh: 0.1 });
    expect(res.status).toBe(401);
  });

  it("runs the full prosumer -> offer -> consumer -> purchase -> blockchain flow over HTTP", async () => {
    const seller = await request(app)
      .post("/api/auth/register")
      .send({ id: "seller-1", name: "Seller", type: "prosumer", location: "Tunis", password: "password123", batteryCapacityKwh: 10 });
    const sellerToken = seller.body.data.token;

    const measure = await request(app)
      .post("/api/energy/measurements")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ production: 8, consumption: 3 });
    expect(measure.status).toBe(201);
    expect(measure.body.data.measurement.surplus).toBe(5);

    const offerRes = await request(app)
      .post("/api/market/offers")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ amountKwh: 3, pricePerKwh: 0.2 });
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body.data.id;

    const buyer = await request(app)
      .post("/api/auth/register")
      .send({ id: "buyer-1", name: "Buyer", type: "consumer", location: "Tunis", password: "password123" });
    // Starting TEC comes from the server-side consumer welcome grant.
    expect(buyer.body.data.household.tokenBalance).toBeGreaterThan(0);
    const buyerToken = buyer.body.data.token;

    const purchase = await request(app)
      .post(`/api/market/offers/${offerId}/purchase`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ amountKwh: 3 });
    expect(purchase.status).toBe(201);
    expect(purchase.body.data.status).toBe("completed");

    const blocks = await request(app).get("/api/blockchain/blocks");
    expect(blocks.status).toBe(200);
    expect(blocks.body.data.length).toBeGreaterThan(1);

    const dashboard = await request(app).get("/api/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.completedTrades).toBe(1);
  });

  it("prevents a household from cancelling another household's offer", async () => {
    const seller = await request(app)
      .post("/api/auth/register")
      .send({ id: "seller-2", name: "Seller", type: "prosumer", location: "Tunis", password: "password123" });
    await request(app)
      .post("/api/energy/measurements")
      .set("Authorization", `Bearer ${seller.body.data.token}`)
      .send({ production: 8, consumption: 3 });
    const offerRes = await request(app)
      .post("/api/market/offers")
      .set("Authorization", `Bearer ${seller.body.data.token}`)
      .send({ amountKwh: 2, pricePerKwh: 0.1 });

    const intruder = await request(app)
      .post("/api/auth/register")
      .send({ id: "intruder", name: "Intruder", type: "producer", location: "Tunis", password: "password123" });

    const cancel = await request(app)
      .post(`/api/market/offers/${offerRes.body.data.id}/cancel`)
      .set("Authorization", `Bearer ${intruder.body.data.token}`);
    expect(cancel.status).toBe(403);
  });
});
