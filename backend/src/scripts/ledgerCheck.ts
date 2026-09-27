import { getDatabase, closeDatabase } from "../db/database.js";
import { createContainer } from "../container.js";

/** `npm run ledger:check` — verifies the hash chain and reconciles every
 * balance against its transaction history. Prints a JSON report; exits 1 if
 * anything is wrong (suitable for a cron job or CI smoke check). */
const container = createContainer(getDatabase());
const report = container.ledger.checkIntegrity();
const anchoring = container.blockchain.getStatus().anchoring;

console.log(JSON.stringify({ ...report, anchoring }, null, 2));
closeDatabase();

const ok = report.chain.valid && report.reconciliation.ok && anchoring.failed === 0;
console.error(ok ? "ledger check: OK" : "ledger check: PROBLEMS FOUND");
process.exit(ok ? 0 : 1);
