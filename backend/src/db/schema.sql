-- Canonical schema. Run in full by database.ts on every boot (single source
-- of truth — the reference architecture this builds on had schema.sql and
-- initDatabase() drift apart; we avoid that by only ever executing this file).

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
  tokenBalance REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
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
  blockchainTxId TEXT,
  createdAt INTEGER NOT NULL,
  completedAt INTEGER
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('MINT', 'TRANSFER', 'TRADE_SETTLEMENT')),
  fromHouseholdId TEXT REFERENCES households(id),
  toHouseholdId TEXT NOT NULL REFERENCES households(id),
  amount REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  blockchainTxId TEXT,
  relatedTradeId TEXT
);

CREATE TABLE IF NOT EXISTS blockchain_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('MINT', 'TRANSFER', 'TRADE')),
  fromId TEXT,
  toId TEXT NOT NULL,
  amount REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  blockIndex INTEGER,
  hederaTransactionId TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blockchain_blocks (
  idx INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  previousHash TEXT NOT NULL,
  hash TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  transactionIds TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_measurements_household ON energy_measurements(householdId);
CREATE INDEX IF NOT EXISTS idx_measurements_timestamp ON energy_measurements(timestamp);
CREATE INDEX IF NOT EXISTS idx_offers_seller ON energy_offers(sellerId);
CREATE INDEX IF NOT EXISTS idx_offers_status ON energy_offers(status);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON energy_trades(sellerId);
CREATE INDEX IF NOT EXISTS idx_trades_buyer ON energy_trades(buyerId);
CREATE INDEX IF NOT EXISTS idx_trades_status ON energy_trades(status);
CREATE INDEX IF NOT EXISTS idx_token_tx_to ON token_transactions(toHouseholdId);
CREATE INDEX IF NOT EXISTS idx_token_tx_from ON token_transactions(fromHouseholdId);
CREATE INDEX IF NOT EXISTS idx_blockchain_tx_timestamp ON blockchain_transactions(timestamp);
