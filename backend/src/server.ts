import { createServer } from "node:http";
import { assertValidEnv, env, isHederaConfigured } from "./config/env.js";
import { getDatabase } from "./db/database.js";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import { seedDemoData } from "./scripts/seedData.js";
import { attachWebSocketServer } from "./ws/websocketServer.js";

// Fail fast on insecure/invalid configuration, before touching any data.
try {
  assertValidEnv();
} catch (err) {
  console.error(`[server] refusing to start — ${(err as Error).message}`);
  process.exit(1);
}

const db = getDatabase();
const container = createContainer(db);
const app = createApp(container);

const httpServer = createServer(app);
attachWebSocketServer(httpServer, container.notifications);

async function start() {
  const householdCount = (db.prepare(`SELECT COUNT(*) as n FROM households`).get() as { n: number }).n;
  if (householdCount === 0 && env.seedDemoData) {
    console.log("[server] empty database detected — seeding demo households (5 producers + 5 consumers)");
    await seedDemoData(container, (msg) => console.log(msg));
  }

  httpServer.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
    console.log(`[server] blockchain mode: ${container.blockchain.mode} ${isHederaConfigured ? "(real Hedera testnet)" : "(local simulated ledger — set HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY/HEDERA_TOKEN_ID to switch)"}`);
  });

  if (env.simulationEnabled) {
    container.simulation.start();
  }
}

void start();

function shutdown() {
  container.simulation.stop();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
