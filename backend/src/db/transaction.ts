import type { Database } from "better-sqlite3";

/**
 * Runs `fn` as one atomic unit: every write commits together or not at all
 * (any throw rolls everything back). Uses BEGIN IMMEDIATE so the write lock is
 * taken up front — a read-then-write inside `fn` can't interleave with another
 * process's write. Nested calls become savepoints of the outer transaction.
 *
 * `fn` must be synchronous: never await inside it.
 */
export function atomic<T>(db: Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}
