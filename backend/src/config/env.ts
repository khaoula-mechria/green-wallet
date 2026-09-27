import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  return Number(value);
}

/** CORS_ORIGIN: unset -> "*" in development, disabled (same-origin only) in
 * production; otherwise "*" or a comma-separated list of allowed origins. */
function corsOrigins(value: string | undefined, production: boolean): "*" | string[] | false {
  if (value === undefined || value.trim() === "") return production ? false : "*";
  if (value.trim() === "*") return "*";
  return value.split(",").map((o) => o.trim()).filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

const DEV_JWT_SECRET = "dev-insecure-secret-change-me";
const DEV_KEY_ENCRYPTION_SECRET = "dev-insecure-key-encryption-secret";

export const env = {
  nodeEnv,
  isProduction,
  port: num(process.env.PORT, 4000),
  jwtSecret: process.env.JWT_SECRET || DEV_JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  dbPath: process.env.DB_PATH ?? path.join(__dirname, "..", "..", "data", "green-wallet.db"),
  corsOrigin: corsOrigins(process.env.CORS_ORIGIN, isProduction),

  // Demo-only behaviour: on by default in development, opt-in in production.
  seedDemoData: bool(process.env.SEED_DEMO_DATA, !isProduction),
  simulationEnabled: bool(process.env.SIMULATION_ENABLED, !isProduction),
  simulationTickMs: num(process.env.SIMULATION_TICK_MS, 5000),
  simulationMinutesPerTick: num(process.env.SIMULATION_MINUTES_PER_TICK, 30),

  // Manual meter readings are self-reported and therefore untrusted: they are
  // disabled by default in production until real metering is integrated, and
  // always bounded and rate-limited per household.
  manualMeasurementsEnabled: bool(process.env.MANUAL_MEASUREMENTS_ENABLED, !isProduction),
  measurementMaxKwh: num(process.env.MEASUREMENT_MAX_KWH, 50),
  measurementMinIntervalMs: num(process.env.MEASUREMENT_MIN_INTERVAL_MS, 60_000),

  // TEC granted server-side to newly registered consumers so they can trade.
  // Clients can never choose their own starting balance.
  signupGrantTec: num(process.env.SIGNUP_GRANT_TEC, isProduction ? 0 : 20),

  // Blockchain mode selection. Hedera mode only activates when ALL three are set,
  // mirroring the reference system's "if TEC_TOKEN_ID set" gating pattern.
  hederaOperatorId: process.env.HEDERA_OPERATOR_ID ?? "",
  hederaOperatorKey: process.env.HEDERA_OPERATOR_KEY ?? "",
  hederaTokenId: process.env.HEDERA_TOKEN_ID ?? "",

  keyEncryptionSecret: process.env.KEY_ENCRYPTION_SECRET || DEV_KEY_ENCRYPTION_SECRET,
};

export type Env = typeof env;

export const isHederaConfigured =
  env.hederaOperatorId.length > 0 && env.hederaOperatorKey.length > 0 && env.hederaTokenId.length > 0;

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRETS = new Set([DEV_JWT_SECRET, DEV_KEY_ENCRYPTION_SECRET, "replace-with-a-long-random-string"]);

/** Returns every configuration problem that must block a production boot. */
export function validateEnv(e: Env = env): string[] {
  const problems: string[] = [];

  for (const [name, value] of [
    ["PORT", e.port],
    ["SIMULATION_TICK_MS", e.simulationTickMs],
    ["SIMULATION_MINUTES_PER_TICK", e.simulationMinutesPerTick],
    ["MEASUREMENT_MAX_KWH", e.measurementMaxKwh],
    ["MEASUREMENT_MIN_INTERVAL_MS", e.measurementMinIntervalMs],
    ["SIGNUP_GRANT_TEC", e.signupGrantTec],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) problems.push(`${name} must be a non-negative number`);
  }

  if (!e.isProduction) return problems;

  for (const [name, value] of [
    ["JWT_SECRET", e.jwtSecret],
    ["KEY_ENCRYPTION_SECRET", e.keyEncryptionSecret],
  ] as const) {
    if (PLACEHOLDER_SECRETS.has(value)) problems.push(`${name} is unset or still a placeholder`);
    else if (value.length < MIN_SECRET_LENGTH) problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (e.jwtSecret === e.keyEncryptionSecret) problems.push("JWT_SECRET and KEY_ENCRYPTION_SECRET must differ");
  if (e.corsOrigin === "*") problems.push("CORS_ORIGIN must not be '*' in production (leave unset for same-origin)");

  return problems;
}

/** Called once at server boot: throws on any blocking problem, and warns
 * loudly about demo features explicitly left on in production. */
export function assertValidEnv(e: Env = env): void {
  const problems = validateEnv(e);
  if (problems.length > 0) {
    throw new Error(`invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
  if (e.isProduction) {
    if (e.seedDemoData) console.warn("[config] WARNING: SEED_DEMO_DATA is on in production — demo accounts use a public password");
    if (e.simulationEnabled) console.warn("[config] WARNING: SIMULATION_ENABLED is on in production — readings are simulated");
    if (e.manualMeasurementsEnabled) console.warn("[config] WARNING: MANUAL_MEASUREMENTS_ENABLED is on in production — readings are self-reported");
  }
}
