import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  dbPath: process.env.DB_PATH ?? path.join(__dirname, "..", "..", "data", "green-wallet.db"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  // Simulation
  simulationEnabled: bool(process.env.SIMULATION_ENABLED, true),
  simulationTickMs: Number(process.env.SIMULATION_TICK_MS ?? 5000),
  simulationMinutesPerTick: Number(process.env.SIMULATION_MINUTES_PER_TICK ?? 30),

  // Blockchain mode selection. Hedera mode only activates when ALL three are set,
  // mirroring the reference system's "if TEC_TOKEN_ID set" gating pattern.
  hederaOperatorId: process.env.HEDERA_OPERATOR_ID ?? "",
  hederaOperatorKey: process.env.HEDERA_OPERATOR_KEY ?? "",
  hederaTokenId: process.env.HEDERA_TOKEN_ID ?? "",

  keyEncryptionSecret: process.env.KEY_ENCRYPTION_SECRET ?? "dev-insecure-key-encryption-secret",
};

export const isHederaConfigured =
  env.hederaOperatorId.length > 0 && env.hederaOperatorKey.length > 0 && env.hederaTokenId.length > 0;
