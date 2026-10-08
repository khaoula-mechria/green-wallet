import type { Database } from "better-sqlite3";
import type { Account, AccountKind, CertificateAsset } from "../../domain/types.js";

export class AccountRepository {
  constructor(private readonly db: Database) {}

  insert(a: Account): void {
    this.db
      .prepare(
        `INSERT INTO accounts
          (id, kind, householdId, label, balance, reservedBalance, solarBalance, windBalance, createdAt)
         VALUES (@id, @kind, @householdId, @label, @balance, @reservedBalance, @solarBalance, @windBalance, @createdAt)`
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

  sumBalances(): number {
    return (this.db.prepare(`SELECT COALESCE(SUM(balance), 0) AS total FROM accounts`).get() as { total: number }).total;
  }

  sumCertificateBalances(asset: CertificateAsset): number {
    const column = asset === "SOLAR" ? "solarBalance" : "windBalance";
    return (this.db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS total FROM accounts`).get() as { total: number }).total;
  }

  updateCertificateBalance(id: string, asset: CertificateAsset, delta: number): void {
    const column = asset === "SOLAR" ? "solarBalance" : "windBalance";
    // Amounts are 0.01 kWh steps; rounding keeps float drift (0.3 - 0.1 - 0.2) from tripping the >= 0 CHECK.
    this.db.prepare(`UPDATE accounts SET ${column} = ROUND(${column} + ?, 6) WHERE id = ?`).run(delta, id);
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
