import { getDatabase } from "../db/database.js";
import { createContainer } from "../container.js";
import { seedDemoData, SEED_PASSWORD } from "./seedData.js";

/** CLI entry point: `npm run seed`. Safe to re-run — existing ids are skipped.
 * The same seeding logic also runs automatically on server boot if the
 * database is empty (see server.ts). */
async function main() {
  const db = getDatabase();
  const c = createContainer(db);
  await seedDemoData(c);
  console.log(`\n[seed] done. Login with any household id above and password "${SEED_PASSWORD}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
