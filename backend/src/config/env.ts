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

  // Phase 3: the market clock (docs/DESIGN.md §0.6). One auction per interval; it
  // runs even when the simulation is off. Defaults follow the simulation tick.
  marketIntervalMs: num(process.env.MARKET_INTERVAL_MS, num(process.env.SIMULATION_TICK_MS, 5000)),
  marketIntervalSimMinutes: num(process.env.MARKET_INTERVAL_SIM_MINUTES, num(process.env.SIMULATION_MINUTES_PER_TICK, 30)),

  // Manual meter readings are self-reported and therefore untrusted: they are
  // disabled by default in production until real metering is integrated, and
  // always bounded and rate-limited per household.
  manualMeasurementsEnabled: bool(process.env.MANUAL_MEASUREMENTS_ENABLED, !isProduction),
  measurementMaxKwh: num(process.env.MEASUREMENT_MAX_KWH, 50),
  measurementMinIntervalMs: num(process.env.MEASUREMENT_MIN_INTERVAL_MS, 60_000),

  // Phase 0: Ledger and money.
  // Treasury initial funding (TEC); validators ensure >= 0.
  treasuryInitialTec: num(process.env.TREASURY_INITIAL_TEC, 10_000),
  // Low treasury warning threshold (TEC).
  treasuryLowWarningTec: num(process.env.TREASURY_LOW_WARNING_TEC, 1_000),
  // Welcome grant to new prosumers and consumers (TEC).
  welcomeGrantTec: num(process.env.WELCOME_GRANT_TEC, 10),
  // Grid storage initial funding (TEC); optional, sets grid pool starting balance.
  gridStorageInitialTec: num(process.env.GRID_STORAGE_INITIAL_TEC, 500),
  // Top-ups: enabled in dev by default, opt-in in production.
  topupsEnabled: bool(process.env.TOPUPS_ENABLED, !isProduction),
  // Per-top-up cap (TEC); capped here before even reaching the ledger.
  topupMaxTec: num(process.env.TOPUP_MAX_TEC, 100),
  // Rate limit: cooldown between top-ups per household (ms).
  topupCooldownMs: num(process.env.TOPUP_COOLDOWN_MS, 10_000),
  // Simulated Hedera network fee (HBAR) attached to every ledger transaction, paid by operator.
  simulatedFeeHbar: num(process.env.SIMULATED_FEE_HBAR, 0.0001),

  // Phase 2: the utility's prices (docs/DESIGN.md §3.1). The floor (export) and ceiling
  // (import) are derived from these components by priceBand().
  wholesalePriceTec: num(process.env.WHOLESALE_PRICE_TEC, 0.08),
  networkFeeTec: num(process.env.NETWORK_FEE_TEC, 0.09),
  taxesTec: num(process.env.TAXES_TEC, 0.08),
  supplierMarginTec: num(process.env.SUPPLIER_MARGIN_TEC, 0.05),
  utilityBalancingCostTec: num(process.env.UTILITY_BALANCING_COST_TEC, 0.03),

  // Phase 2: batteries and the shared battery (§1, §6).
  householdDefaultBatteryCapacityKwh: num(process.env.HOUSEHOLD_DEFAULT_BATTERY_CAPACITY_KWH, 10),
  householdMaxBatteryCapacityKwh: num(process.env.HOUSEHOLD_MAX_BATTERY_CAPACITY_KWH, 50),
  sharedBatteryCapacityKwh: num(process.env.SHARED_BATTERY_CAPACITY_KWH, 100),
  sharedBatteryRentedShare: num(process.env.SHARED_BATTERY_RENTED_SHARE, 0.6),
  rentedCapPerHouseholdKwh: num(process.env.RENTED_CAP_PER_HOUSEHOLD_KWH, 10),
  storageDecayPerSimHour: num(process.env.STORAGE_DECAY_PER_SIM_HOUR, 0.01),
  gridPoolInitialShare: num(process.env.GRID_POOL_INITIAL_SHARE, 0.5),
  gridPoolBuyBelowAvg: num(process.env.GRID_POOL_BUY_BELOW_AVG, 0.9),
  gridPoolSellAboveAvg: num(process.env.GRID_POOL_SELL_ABOVE_AVG, 1.1),
  offerExpirySimHours: num(process.env.OFFER_EXPIRY_SIM_HOURS, 24),

  // Blockchain mode selection. Hedera mode only activates when ALL three are set,
  // mirroring the reference system's "if TEC_TOKEN_ID set" gating pattern.
  hederaOperatorId: process.env.HEDERA_OPERATOR_ID ?? "",
  hederaOperatorKey: process.env.HEDERA_OPERATOR_KEY ?? "",
  hederaTokenId: process.env.HEDERA_TOKEN_ID ?? "",

  keyEncryptionSecret: process.env.KEY_ENCRYPTION_SECRET || DEV_KEY_ENCRYPTION_SECRET,
};

export type Env = typeof env;

export interface PriceBand {
  floor: number;
  ceiling: number;
  mid: number;
  components: { wholesale: number; networkFee: number; taxes: number; supplierMargin: number; balancingCost: number };
}

/** DESIGN.md §3.1: the utility's prices, built from cost components.
 *  ceiling (import) = wholesale + network + taxes + margin; floor (export) = wholesale - balancing. */
export function priceBand(e: Env = env): PriceBand {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const ceiling = r3(e.wholesalePriceTec + e.networkFeeTec + e.taxesTec + e.supplierMarginTec);
  const floor = r3(e.wholesalePriceTec - e.utilityBalancingCostTec);
  return {
    floor,
    ceiling,
    mid: r3((floor + ceiling) / 2),
    components: {
      wholesale: e.wholesalePriceTec,
      networkFee: e.networkFeeTec,
      taxes: e.taxesTec,
      supplierMargin: e.supplierMarginTec,
      balancingCost: e.utilityBalancingCostTec,
    },
  };
}

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
    ["TREASURY_INITIAL_TEC", e.treasuryInitialTec],
    ["TREASURY_LOW_WARNING_TEC", e.treasuryLowWarningTec],
    ["GRID_STORAGE_INITIAL_TEC", e.gridStorageInitialTec],
    ["WELCOME_GRANT_TEC", e.welcomeGrantTec],
    ["TOPUP_MAX_TEC", e.topupMaxTec],
    ["TOPUP_COOLDOWN_MS", e.topupCooldownMs],
    ["SIMULATED_FEE_HBAR", e.simulatedFeeHbar],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) problems.push(`${name} must be a non-negative number`);
  }
  for (const [name, value] of [
    ["WHOLESALE_PRICE_TEC", e.wholesalePriceTec],
    ["NETWORK_FEE_TEC", e.networkFeeTec],
    ["TAXES_TEC", e.taxesTec],
    ["SUPPLIER_MARGIN_TEC", e.supplierMarginTec],
    ["UTILITY_BALANCING_COST_TEC", e.utilityBalancingCostTec],
    ["HOUSEHOLD_DEFAULT_BATTERY_CAPACITY_KWH", e.householdDefaultBatteryCapacityKwh],
    ["MARKET_INTERVAL_MS", e.marketIntervalMs],
    ["MARKET_INTERVAL_SIM_MINUTES", e.marketIntervalSimMinutes],
    ["HOUSEHOLD_MAX_BATTERY_CAPACITY_KWH", e.householdMaxBatteryCapacityKwh],
    ["SHARED_BATTERY_CAPACITY_KWH", e.sharedBatteryCapacityKwh],
    ["RENTED_CAP_PER_HOUSEHOLD_KWH", e.rentedCapPerHouseholdKwh],
    ["OFFER_EXPIRY_SIM_HOURS", e.offerExpirySimHours],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) problems.push(`${name} must be a non-negative number`);
  }
  for (const [name, value] of [
    ["SHARED_BATTERY_RENTED_SHARE", e.sharedBatteryRentedShare],
    ["STORAGE_DECAY_PER_SIM_HOUR", e.storageDecayPerSimHour],
    ["GRID_POOL_INITIAL_SHARE", e.gridPoolInitialShare],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) problems.push(`${name} must be between 0 and 1`);
  }
  const band = priceBand(e);
  if (!(band.floor >= 0 && band.floor < band.ceiling)) {
    problems.push(`price band is invalid: floor ${band.floor} must be >= 0 and below the ceiling ${band.ceiling}`);
  }
  if (!(e.marketIntervalMs >= 100)) problems.push("MARKET_INTERVAL_MS must be at least 100");
  if (!(e.marketIntervalSimMinutes > 0 && 1440 % e.marketIntervalSimMinutes === 0)) {
    problems.push("MARKET_INTERVAL_SIM_MINUTES must divide a day (e.g. 15, 30, 60)");
  }
  if (e.householdDefaultBatteryCapacityKwh > e.householdMaxBatteryCapacityKwh) {
    problems.push("HOUSEHOLD_DEFAULT_BATTERY_CAPACITY_KWH must not exceed HOUSEHOLD_MAX_BATTERY_CAPACITY_KWH");
  }
  if (e.gridStorageInitialTec > e.treasuryInitialTec) {
    problems.push("GRID_STORAGE_INITIAL_TEC must not exceed TREASURY_INITIAL_TEC (it is funded from the treasury)");
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
    if (e.topupsEnabled) console.warn("[config] WARNING: TOPUPS_ENABLED is on in production — real payment integration required");
    if (e.treasuryInitialTec < e.treasuryLowWarningTec) console.warn("[config] WARNING: TREASURY_INITIAL_TEC is below TREASURY_LOW_WARNING_TEC threshold");
  }
}
