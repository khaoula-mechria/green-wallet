// Defaults from docs/DESIGN.md §10. The backend will read the same values
// from environment variables.

export const PRICE_COMPONENTS = {
  wholesale: 0.08,
  networkFee: 0.09,
  taxes: 0.08,
  supplierMargin: 0.05,
  balancingCost: 0.03,
};

// DESIGN.md §3.1 — the band is built from the utility's cost components.
export const CEILING = round3(
  PRICE_COMPONENTS.wholesale + PRICE_COMPONENTS.networkFee + PRICE_COMPONENTS.taxes + PRICE_COMPONENTS.supplierMargin
);
export const FLOOR = round3(PRICE_COMPONENTS.wholesale - PRICE_COMPONENTS.balancingCost);
export const MID = round3((FLOOR + CEILING) / 2);

if (!(FLOOR >= 0 && FLOOR < CEILING)) {
  throw new Error(`invalid price band: floor ${FLOOR} must be >= 0 and < ceiling ${CEILING}`);
}

export const INTERVAL_MS = 5000;
export const SIM_MINUTES_PER_INTERVAL = 30;
export const INTERVALS_PER_HOUR = 60 / SIM_MINUTES_PER_INTERVAL;
export const START_SIM_MINUTES = 6 * 60;

export const DEFAULT_BATTERY_KWH = 10;
export const MAX_BATTERY_KWH = 50;

export const SHARED_BATTERY_KWH = 100;
export const RENTED_SHARE = 0.6;
export const RENTED_CAPACITY_KWH = SHARED_BATTERY_KWH * RENTED_SHARE;
export const GRID_POOL_CAPACITY_KWH = SHARED_BATTERY_KWH - RENTED_CAPACITY_KWH;
export const RENTED_CAP_PER_HOUSEHOLD_KWH = 10;
export const GRID_POOL_INITIAL_SHARE = 0.5;

export const STORAGE_DECAY_PER_HOUR = 0.01;
export const DECAY_FACTOR_PER_INTERVAL = Math.pow(1 - STORAGE_DECAY_PER_HOUR, SIM_MINUTES_PER_INTERVAL / 60);
export const MIN_STORED_KWH = 0.01;

export const GRID_POOL_BUY_BELOW_AVG = 0.9;
export const GRID_POOL_SELL_ABOVE_AVG = 1.1;
export const AVG_WINDOW_INTERVALS = 24 * INTERVALS_PER_HOUR;

export const OFFER_EXPIRY_INTERVALS = 24 * INTERVALS_PER_HOUR;
export const MIN_OFFER_KWH = 0.1;

export const TREASURY_INITIAL_TEC = 10_000;
export const GRID_STORAGE_FUNDING_TEC = 500;
export const WELCOME_GRANT_TEC = 10;
export const TOPUPS_ENABLED = true;
export const TOPUP_MAX_TEC = 100;
export const TOPUP_COOLDOWN_MS = 10_000;
export const SIMULATED_FEE_HBAR = 0.0001;

export const SEED_PASSWORD = "password123";

export const MAX_LEDGER_TXS = 4000;
export const MAX_BLOCKS = 500;
export const MAX_READINGS_PER_HOUSEHOLD = 96;
export const MAX_PRICE_HISTORY = 192;

export const ACCOUNTS = {
  operator: "0.0.1000",
  treasury: "0.0.1001",
  clearing: "0.0.1002",
  gridStorage: "0.0.1003",
  utility: "0.0.1004",
};

export const TOKEN_IDS = { TEC: "0.0.5001", SOLAR: "0.0.5002", WIND: "0.0.5003" };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
