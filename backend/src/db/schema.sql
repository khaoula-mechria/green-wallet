-- Canonical schema (Phase 3 — the auction).
-- Run in full by database.ts on every boot. DB is wiped on schema version mismatch.

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('producer', 'consumer', 'prosumer')),
  location TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  hederaAccountId TEXT,
  hederaPrivateKeyEncrypted TEXT,
  energyType TEXT NOT NULL DEFAULT 'grid',
  currentProduction REAL NOT NULL DEFAULT 0,
  currentConsumption REAL NOT NULL DEFAULT 0,
  -- Energy stocks (DESIGN.md §1, §6): own battery, and rented space in the shared battery.
  batteryCapacityKwh REAL NOT NULL DEFAULT 0 CHECK (batteryCapacityKwh >= 0),
  batteryKwh REAL NOT NULL DEFAULT 0 CHECK (batteryKwh >= 0),
  storedKwh REAL NOT NULL DEFAULT 0 CHECK (storedKwh >= 0),
  -- This interval's surplus and deficit, waiting for the auction (§4, §5).
  pendingSellKwh REAL NOT NULL DEFAULT 0 CHECK (pendingSellKwh >= 0),
  pendingBuyKwh REAL NOT NULL DEFAULT 0 CHECK (pendingBuyKwh >= 0),
  -- Market agent settings (§4.1); the price limits are used by the Phase 3 auction.
  overflowMode TEXT NOT NULL DEFAULT 'sell' CHECK (overflowMode IN ('sell', 'store')),
  minSellPrice REAL NOT NULL,
  maxBuyPrice REAL NOT NULL,
  storeMinPrice REAL NOT NULL,
  batterySellEnabled INTEGER NOT NULL DEFAULT 0,
  batterySellMinPrice REAL NOT NULL,
  batteryKeepPercent REAL NOT NULL DEFAULT 20 CHECK (batteryKeepPercent BETWEEN 0 AND 100),
  auctionOptOut INTEGER NOT NULL DEFAULT 0,
  -- Utility statement (§7.4): real money, off the ledger.
  importedKwh REAL NOT NULL DEFAULT 0,
  importCost REAL NOT NULL DEFAULT 0,
  exportedKwh REAL NOT NULL DEFAULT 0,
  exportCredit REAL NOT NULL DEFAULT 0,
  -- Lifetime consumption, split by origin for the green-share KPI (grey = total - solar - wind).
  consumedKwh REAL NOT NULL DEFAULT 0,
  consumedSolarKwh REAL NOT NULL DEFAULT 0,
  consumedWindKwh REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY CHECK (id GLOB '0.0.[0-9]*'),
  kind TEXT NOT NULL CHECK (kind IN ('household', 'treasury', 'clearing', 'grid_storage', 'utility')),
  householdId TEXT UNIQUE REFERENCES households(id),
  label TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  reservedBalance REAL NOT NULL DEFAULT 0,
  -- Green certificates held, in kWh (on real Hedera: two HTS token balances).
  solarBalance REAL NOT NULL DEFAULT 0 CHECK (solarBalance >= 0),
  windBalance REAL NOT NULL DEFAULT 0 CHECK (windBalance >= 0),
  createdAt INTEGER NOT NULL
);

-- The operator's share of the community battery (§6.1). Single row; the rented
-- compartment is the sum of households.storedKwh.
CREATE TABLE IF NOT EXISTS grid_storage (
  id TEXT PRIMARY KEY CHECK (id = 'grid'),
  poolKwh REAL NOT NULL DEFAULT 0 CHECK (poolKwh >= 0),
  -- Energy that entered the microgrid without being produced or imported
  -- (pre-charged grid pool, pre-charged demo batteries): needed for the energy check.
  initialStockKwh REAL NOT NULL DEFAULT 0,
  -- Decayed energy the full grid pool could not take, exported by the operator.
  operatorExportedKwh REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS energy_measurements (
  id TEXT PRIMARY KEY,
  householdId TEXT NOT NULL REFERENCES households(id),
  timestamp INTEGER NOT NULL,
  simTime INTEGER NOT NULL DEFAULT 0,
  interval INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'simulation' CHECK (source IN ('simulation', 'manual')),
  production REAL NOT NULL,
  consumption REAL NOT NULL,
  surplus REAL NOT NULL,
  -- Where the energy went (§5). Own sources settle at the reading; the auction
  -- columns are filled when the interval settles.
  selfUseKwh REAL NOT NULL DEFAULT 0,
  toBatteryKwh REAL NOT NULL DEFAULT 0,
  toStorageKwh REAL NOT NULL DEFAULT 0,
  toAuctionKwh REAL NOT NULL DEFAULT 0,
  fromBatteryKwh REAL NOT NULL DEFAULT 0,
  fromStorageKwh REAL NOT NULL DEFAULT 0,
  toBuyKwh REAL NOT NULL DEFAULT 0,
  soldKwh REAL NOT NULL DEFAULT 0,
  exportedKwh REAL NOT NULL DEFAULT 0,
  boughtKwh REAL NOT NULL DEFAULT 0,
  importedKwh REAL NOT NULL DEFAULT 0,
  price REAL,
  settled INTEGER NOT NULL DEFAULT 1
);

-- One row per settled interval: the price history (§4.3).
CREATE TABLE IF NOT EXISTS auctions (
  interval INTEGER PRIMARY KEY,
  simTime INTEGER NOT NULL,
  clearingPrice REAL,
  volume REAL NOT NULL,
  lastMatchedSellPrice REAL,
  lastMatchedBuyPrice REAL,
  exportedKwh REAL NOT NULL,
  importedKwh REAL NOT NULL,
  avg24h REAL NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id TEXT PRIMARY KEY,
  interval INTEGER NOT NULL REFERENCES auctions(interval),
  participantId TEXT NOT NULL,
  participantName TEXT NOT NULL,
  participantType TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
  source TEXT NOT NULL,
  quantity REAL NOT NULL,
  limitPrice REAL NOT NULL,
  matched REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS energy_offers (
  id TEXT PRIMARY KEY,
  sellerId TEXT NOT NULL REFERENCES households(id),
  amountKwh REAL NOT NULL,
  amountRemainingKwh REAL NOT NULL,
  pricePerKwh REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
  expiresAtSimTime INTEGER NOT NULL,
  expiresAtInterval INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS energy_trades (
  id TEXT PRIMARY KEY,
  offerId TEXT NOT NULL REFERENCES energy_offers(id),
  sellerId TEXT NOT NULL REFERENCES households(id),
  buyerId TEXT NOT NULL REFERENCES households(id),
  amountKwh REAL NOT NULL,
  pricePerKwh REAL NOT NULL,
  totalPrice REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  ledgerTxId TEXT,
  certSolarKwh REAL NOT NULL DEFAULT 0,
  certWindKwh REAL NOT NULL DEFAULT 0,
  simTime INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  completedAt INTEGER
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('TEC', 'SOLAR', 'WIND', 'RECORD')),
  fromAccountId TEXT REFERENCES accounts(id),
  toAccountId TEXT REFERENCES accounts(id),
  amount REAL NOT NULL,
  feeHbar REAL NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  simTime INTEGER NOT NULL DEFAULT 0,
  blockIndex INTEGER,
  relatedTradeId TEXT
);

CREATE TABLE IF NOT EXISTS blockchain_blocks (
  idx INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  simTime INTEGER NOT NULL DEFAULT 0,
  previousHash TEXT NOT NULL,
  hash TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  transactionIds TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_measurements_household ON energy_measurements(householdId);
CREATE INDEX IF NOT EXISTS idx_measurements_timestamp ON energy_measurements(timestamp);
CREATE INDEX IF NOT EXISTS idx_offers_seller ON energy_offers(sellerId);
CREATE INDEX IF NOT EXISTS idx_offers_status ON energy_offers(status);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON energy_trades(sellerId);
CREATE INDEX IF NOT EXISTS idx_trades_buyer ON energy_trades(buyerId);
CREATE INDEX IF NOT EXISTS idx_trades_status ON energy_trades(status);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_timestamp ON ledger_transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_asset ON ledger_transactions(asset);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_from ON ledger_transactions(fromAccountId);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_to ON ledger_transactions(toAccountId);
CREATE INDEX IF NOT EXISTS idx_accounts_household ON accounts(householdId);
CREATE INDEX IF NOT EXISTS idx_measurements_interval ON energy_measurements(householdId, interval);
CREATE INDEX IF NOT EXISTS idx_auction_bids_interval ON auction_bids(interval);
