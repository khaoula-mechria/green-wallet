import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { runMigrations } from "./migrations.js";

let dbInstance: Database.Database | null = null;

function configure(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  // Wait for a competing writer (e.g. a second process) instead of failing.
  db.pragma("busy_timeout = 5000");
}

export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(env.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new Database(env.dbPath);
  dbInstance.pragma("journal_mode = WAL");
  configure(dbInstance);
  runMigrations(dbInstance, (msg) => console.log(msg));

  return dbInstance;
}

/** Used by tests to get a fresh in-memory database. */
export function createInMemoryDatabase(): Database.Database {
  const db = new Database(":memory:");
  configure(db);
  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
