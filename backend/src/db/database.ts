import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CURRENT_SCHEMA_VERSION = 4;

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(env.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new Database(env.dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");

  const schemaVersion = (dbInstance.pragma("user_version") as { user_version: number }[])[0]?.user_version ?? 0;
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    console.log(`[db] schema version mismatch (current: ${schemaVersion}, expected: ${CURRENT_SCHEMA_VERSION}) — wiping database`);
    // Drop all tables and reset user_version. Foreign keys are off meanwhile,
    // otherwise dropping a referenced table before its dependents fails.
    dbInstance.pragma("foreign_keys = OFF");
    const tables = dbInstance
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      dbInstance.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
    }
    dbInstance.pragma("foreign_keys = ON");
    dbInstance.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  dbInstance.exec(schema);

  return dbInstance;
}

/** Used by tests to get a fresh in-memory database. */
export function createInMemoryDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
