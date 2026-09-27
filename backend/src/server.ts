import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { URL } from "node:url";
import { env, isHederaConfigured } from "./config/env.js";
import { getDatabase } from "./db/database.js";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import { seedDemoData } from "./scripts/seedData.js";

const db = getDatabase();
const container = createContainer(db);
const app = createApp(container);

const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "", "http://localhost");
  const householdId = url.searchParams.get("householdId");
  if (householdId) {
    container.notifications.subscribe(householdId, socket);
  }
});

async function start() {
  const householdCount = (db.prepare(`SELECT COUNT(*) as n FROM households`).get() as { n: number }).n;
  if (householdCount === 0) {
    console.log("[server] empty database detected — seeding demo households (5 producers + 5 consumers)");
    await seedDemoData(container, (msg) => console.log(msg));
  }

  httpServer.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
    console.log(`[server] blockchain mode: ${container.blockchain.mode} ${isHederaConfigured ? "(real Hedera testnet)" : "(local simulated ledger — set HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY/HEDERA_TOKEN_ID to switch)"}`);
  });

  if (env.simulationEnabled) {
    container.simulation.start();
  }
}

void start();

process.on("SIGINT", () => {
  container.simulation.stop();
  httpServer.close(() => process.exit(0));
});
