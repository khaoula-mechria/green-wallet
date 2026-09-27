import type { Database } from "better-sqlite3";

/**
 * Ordered, append-only schema migrations — the single source of truth for the
 * schema. Each runs once, inside a transaction, and is recorded in
 * `schema_migrations`. Never edit a migration that has shipped; add a new one.
 */
interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline",
    // The original schema.sql, verbatim. IF NOT EXISTS makes it a no-op on
    // databases created before migrations existed.
    sql: `
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
    `,
  },
  {
    version: 2,
    name: "integer-units-constraints-ledger-anchoring",
    // Fixed-point integer units (Wh, µTEC) with database-enforced invariants
    // (no negative balances, no fractional units), purchase idempotency keys,
    // opening-balance GRANT records, content-covering block hashes (v2) and
    // external-anchoring state. SQLite can't add CHECK constraints in place,
    // so every table is rebuilt (create new -> copy -> drop -> rename).
    // Existing data that violates an invariant makes this migration fail
    // loudly instead of being silently "fixed".
    sql: `
      CREATE TABLE households_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('producer', 'consumer', 'prosumer')),
        location TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        hederaAccountId TEXT,
        hederaPrivateKeyEncrypted TEXT,
        energyType TEXT NOT NULL DEFAULT 'grid',
        currentProductionWh INTEGER NOT NULL DEFAULT 0 CHECK (typeof(currentProductionWh) = 'integer' AND currentProductionWh >= 0),
        currentConsumptionWh INTEGER NOT NULL DEFAULT 0 CHECK (typeof(currentConsumptionWh) = 'integer' AND currentConsumptionWh >= 0),
        energyBalanceWh INTEGER NOT NULL DEFAULT 0 CHECK (typeof(energyBalanceWh) = 'integer' AND energyBalanceWh >= 0),
        tokenBalanceMicro INTEGER NOT NULL DEFAULT 0 CHECK (typeof(tokenBalanceMicro) = 'integer' AND tokenBalanceMicro >= 0),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO households_new
        SELECT id, name, type, location, passwordHash, hederaAccountId, hederaPrivateKeyEncrypted, energyType,
          CAST(ROUND(currentProduction * 1000) AS INTEGER),
          CAST(ROUND(currentConsumption * 1000) AS INTEGER),
          CAST(ROUND(energyBalance * 1000) AS INTEGER),
          CAST(ROUND(tokenBalance * 1000000) AS INTEGER),
          createdAt, updatedAt
        FROM households;

      CREATE TABLE energy_measurements_new (
        id TEXT PRIMARY KEY,
        householdId TEXT NOT NULL REFERENCES households(id),
        timestamp INTEGER NOT NULL,
        productionWh INTEGER NOT NULL CHECK (typeof(productionWh) = 'integer' AND productionWh >= 0),
        consumptionWh INTEGER NOT NULL CHECK (typeof(consumptionWh) = 'integer' AND consumptionWh >= 0),
        surplusWh INTEGER NOT NULL CHECK (surplusWh = productionWh - consumptionWh)
      );
      INSERT INTO energy_measurements_new
        SELECT id, householdId, timestamp,
          CAST(ROUND(production * 1000) AS INTEGER),
          CAST(ROUND(consumption * 1000) AS INTEGER),
          CAST(ROUND(production * 1000) AS INTEGER) - CAST(ROUND(consumption * 1000) AS INTEGER)
        FROM energy_measurements;

      CREATE TABLE energy_offers_new (
        id TEXT PRIMARY KEY,
        sellerId TEXT NOT NULL REFERENCES households(id),
        amountWh INTEGER NOT NULL CHECK (typeof(amountWh) = 'integer' AND amountWh > 0),
        amountRemainingWh INTEGER NOT NULL CHECK (typeof(amountRemainingWh) = 'integer' AND amountRemainingWh >= 0 AND amountRemainingWh <= amountWh),
        priceMicroPerKwh INTEGER NOT NULL CHECK (typeof(priceMicroPerKwh) = 'integer' AND priceMicroPerKwh > 0),
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      INSERT INTO energy_offers_new
        SELECT id, sellerId,
          CAST(ROUND(amountKwh * 1000) AS INTEGER),
          CAST(ROUND(amountRemainingKwh * 1000) AS INTEGER),
          CAST(ROUND(pricePerKwh * 1000000) AS INTEGER),
          status, createdAt, updatedAt
        FROM energy_offers;

      CREATE TABLE energy_trades_new (
        id TEXT PRIMARY KEY,
        offerId TEXT NOT NULL REFERENCES energy_offers(id),
        sellerId TEXT NOT NULL REFERENCES households(id),
        buyerId TEXT NOT NULL REFERENCES households(id),
        amountWh INTEGER NOT NULL CHECK (typeof(amountWh) = 'integer' AND amountWh > 0),
        priceMicroPerKwh INTEGER NOT NULL CHECK (typeof(priceMicroPerKwh) = 'integer' AND priceMicroPerKwh > 0),
        totalPriceMicro INTEGER NOT NULL CHECK (typeof(totalPriceMicro) = 'integer' AND totalPriceMicro >= 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        blockchainTxId TEXT,
        idempotencyKey TEXT,
        createdAt INTEGER NOT NULL,
        completedAt INTEGER
      );
      INSERT INTO energy_trades_new
        SELECT id, offerId, sellerId, buyerId,
          CAST(ROUND(amountKwh * 1000) AS INTEGER),
          CAST(ROUND(pricePerKwh * 1000000) AS INTEGER),
          CAST(ROUND(totalPrice * 1000000) AS INTEGER),
          status, blockchainTxId, NULL, createdAt, completedAt
        FROM energy_trades;

      CREATE TABLE token_transactions_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('GRANT', 'MINT', 'TRANSFER', 'TRADE_SETTLEMENT')),
        fromHouseholdId TEXT REFERENCES households(id),
        toHouseholdId TEXT NOT NULL REFERENCES households(id),
        amountMicro INTEGER NOT NULL CHECK (typeof(amountMicro) = 'integer' AND amountMicro > 0),
        timestamp INTEGER NOT NULL,
        blockchainTxId TEXT,
        relatedTradeId TEXT
      );
      INSERT INTO token_transactions_new
        SELECT id, type, fromHouseholdId, toHouseholdId, CAST(ROUND(amount * 1000000) AS INTEGER), timestamp, blockchainTxId, relatedTradeId
        FROM token_transactions;

      CREATE TABLE blockchain_transactions_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('GRANT', 'MINT', 'TRANSFER', 'TRADE')),
        fromId TEXT,
        toId TEXT NOT NULL,
        amountMicro INTEGER NOT NULL CHECK (typeof(amountMicro) = 'integer' AND amountMicro > 0),
        timestamp INTEGER NOT NULL,
        blockIndex INTEGER,
        hederaTransactionId TEXT,
        payload TEXT NOT NULL,
        anchorStatus TEXT NOT NULL DEFAULT 'none' CHECK (anchorStatus IN ('none', 'pending', 'anchored', 'failed')),
        anchorAttempts INTEGER NOT NULL DEFAULT 0,
        anchorError TEXT
      );
      INSERT INTO blockchain_transactions_new
        SELECT id, type, fromId, toId, CAST(ROUND(amount * 1000000) AS INTEGER), timestamp, blockIndex, hederaTransactionId, payload,
          CASE WHEN hederaTransactionId IS NOT NULL THEN 'anchored' ELSE 'none' END, 0, NULL
        FROM blockchain_transactions;

      CREATE TABLE blockchain_blocks_new (
        idx INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        previousHash TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        nonce INTEGER NOT NULL,
        transactionIds TEXT NOT NULL,
        hashVersion INTEGER NOT NULL DEFAULT 1 CHECK (hashVersion IN (1, 2))
      );
      INSERT INTO blockchain_blocks_new
        SELECT idx, timestamp, previousHash, hash, nonce, transactionIds, 1 FROM blockchain_blocks;

      DROP TABLE energy_trades;
      DROP TABLE token_transactions;
      DROP TABLE energy_offers;
      DROP TABLE energy_measurements;
      DROP TABLE blockchain_transactions;
      DROP TABLE blockchain_blocks;
      DROP TABLE households;

      ALTER TABLE households_new RENAME TO households;
      ALTER TABLE energy_measurements_new RENAME TO energy_measurements;
      ALTER TABLE energy_offers_new RENAME TO energy_offers;
      ALTER TABLE energy_trades_new RENAME TO energy_trades;
      ALTER TABLE token_transactions_new RENAME TO token_transactions;
      ALTER TABLE blockchain_transactions_new RENAME TO blockchain_transactions;
      ALTER TABLE blockchain_blocks_new RENAME TO blockchain_blocks;

      CREATE INDEX idx_measurements_household ON energy_measurements(householdId, timestamp);
      CREATE INDEX idx_offers_seller ON energy_offers(sellerId);
      CREATE INDEX idx_offers_status ON energy_offers(status);
      CREATE INDEX idx_trades_seller ON energy_trades(sellerId);
      CREATE INDEX idx_trades_buyer ON energy_trades(buyerId);
      CREATE INDEX idx_trades_status ON energy_trades(status, createdAt);
      CREATE UNIQUE INDEX idx_trades_idempotency ON energy_trades(buyerId, idempotencyKey) WHERE idempotencyKey IS NOT NULL;
      CREATE INDEX idx_token_tx_to ON token_transactions(toHouseholdId);
      CREATE INDEX idx_token_tx_from ON token_transactions(fromHouseholdId);
      CREATE INDEX idx_blockchain_tx_timestamp ON blockchain_transactions(timestamp);
      CREATE INDEX idx_blockchain_tx_anchor ON blockchain_transactions(anchorStatus, blockIndex);

      -- Balances created before GRANTs were recorded (signup/seed starting
      -- balances) get an explicit opening-balance record, so that every
      -- household's balance is reproducible from its transaction history.
      INSERT INTO token_transactions (id, type, fromHouseholdId, toHouseholdId, amountMicro, timestamp, blockchainTxId, relatedTradeId)
        SELECT 'opening-balance-' || h.id, 'GRANT', NULL, h.id, diff, h.createdAt, NULL, NULL
        FROM (
          SELECT h.id, h.createdAt,
            h.tokenBalanceMicro
              - COALESCE((SELECT SUM(amountMicro) FROM token_transactions t WHERE t.toHouseholdId = h.id), 0)
              + COALESCE((SELECT SUM(amountMicro) FROM token_transactions t WHERE t.fromHouseholdId = h.id), 0) AS diff
          FROM households h
        ) h
        WHERE diff > 0;
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** @param upTo stop after this version (tests use it to build older schemas). */
export function runMigrations(db: Database, log: (msg: string) => void = () => {}, upTo = LATEST_SCHEMA_VERSION): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    appliedAt INTEGER NOT NULL
  )`);
  const applied = (db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations`).get() as { v: number }).v;
  if (applied > LATEST_SCHEMA_VERSION) {
    throw new Error(`database schema v${applied} is newer than this build supports (v${LATEST_SCHEMA_VERSION})`);
  }
  const pending = MIGRATIONS.filter((m) => m.version > applied && m.version <= upTo);
  if (pending.length === 0) return;

  // Table rebuilds require foreign-key enforcement off; it can only be toggled
  // outside a transaction. Integrity is re-checked before committing each step.
  const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql);
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (violations.length > 0) {
          throw new Error(`migration ${m.version} (${m.name}) left ${violations.length} foreign-key violation(s)`);
        }
        db.prepare(`INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)`).run(m.version, m.name, Date.now());
      }).immediate();
      log(`[db] applied migration ${m.version}: ${m.name}`);
    }
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }
}
