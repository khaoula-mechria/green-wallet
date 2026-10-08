import type { Database } from "better-sqlite3";
import type { Account, AccountKind } from "../../domain/types.js";

export class AccountRepository {
  constructor(private readonly db: Database) {}

  insert(a: Account): void {
    this.db
      .prepare(
        `INSERT INTO accounts
          (id, kind, householdId, label, balance, reservedBalance, createdAt)
         VALUES (@id, @kind, @householdId, @label, @balance, @reservedBalance, @createdAt)`
      )
      .run(a);
  }

  findById(id: string): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined;
  }

  findByHouseholdId(householdId: string): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE householdId = ?`).get(householdId) as Account | undefined;
  }

  findByKind(kind: AccountKind): Account[] {
    return this.db.prepare(`SELECT * FROM accounts WHERE kind = ?`).all(kind) as Account[];
  }

  findAll(): Account[] {
    return this.db.prepare(`SELECT * FROM accounts ORDER BY id`).all() as Account[];
  }

  updateBalance(id: string, delta: number): void {
    this.db.prepare(`UPDATE accounts SET balance = balance + ? WHERE id = ?`).run(delta, id);
  }

  updateReserved(id: string, delta: number): void {
    this.db.prepare(`UPDATE accounts SET reservedBalance = reservedBalance + ? WHERE id = ?`).run(delta, id);
  }

  setReserved(id: string, amount: number): void {
    this.db.prepare(`UPDATE accounts SET reservedBalance = ? WHERE id = ?`).run(amount, id);
  }
}
