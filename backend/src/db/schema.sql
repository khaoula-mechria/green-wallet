-- Canonical schema (Phase 0 — foundations: money and ledger).
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
  energyBalance REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY CHECK (id GLOB '0.0.[0-9]*'),
  kind TEXT NOT NULL CHECK (kind IN ('household', 'treasury', 'clearing', 'grid_storage')),
  householdId TEXT UNIQUE REFERENCES households(id),
  label TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  reservedBalance REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS energy_measurements (
  id TEXT PRIMARY KEY,
  householdId TEXT NOT NULL REFERENCES households(id),
  timestamp INTEGER NOT NULL,
  production REAL NOT NULL,
  consumption REAL NOT NULL,
  surplus REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS energy_offers (
  id TEXT PRIMARY KEY,
  sellerId TEXT NOT NULL REFERENCES households(id),
  amountKwh REAL NOT NULL,
  amountRemainingKwh REAL NOT NULL,
  pricePerKwh REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
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
  blockIndex INTEGER,
  relatedTradeId TEXT
);

CREATE TABLE IF NOT EXISTS blockchain_blocks (
  idx INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
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
