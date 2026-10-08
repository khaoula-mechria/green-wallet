import type { Database } from "better-sqlite3";
import type { Household } from "../../domain/types.js";

export class HouseholdRepository {
  constructor(private readonly db: Database) {}

  insert(h: Household): void {
    this.db
      .prepare(
        `INSERT INTO households
          (id, name, type, location, passwordHash, hederaAccountId, hederaPrivateKeyEncrypted,
           energyType, currentProduction, currentConsumption, energyBalance, createdAt, updatedAt)
         VALUES (@id, @name, @type, @location, @passwordHash, @hederaAccountId, @hederaPrivateKeyEncrypted,
           @energyType, @currentProduction, @currentConsumption, @energyBalance, @createdAt, @updatedAt)`
      )
      .run(h);
  }

  findById(id: string): Household | undefined {
    return this.db.prepare(`SELECT * FROM households WHERE id = ?`).get(id) as Household | undefined;
  }

  findAll(): Household[] {
    return this.db.prepare(`SELECT * FROM households ORDER BY name`).all() as Household[];
  }

  updateSnapshot(id: string, production: number, consumption: number, updatedAt: number): void {
    this.db
      .prepare(
        `UPDATE households SET currentProduction = ?, currentConsumption = ?, updatedAt = ? WHERE id = ?`
      )
      .run(production, consumption, updatedAt, id);
  }

  adjustEnergyBalance(id: string, deltaEnergyBalance: number, updatedAt: number): void {
    this.db
      .prepare(
        `UPDATE households SET energyBalance = energyBalance + ?, updatedAt = ? WHERE id = ?`
      )
      .run(deltaEnergyBalance, updatedAt, id);
  }

  setHederaAccount(id: string, hederaAccountId: string, hederaPrivateKeyEncrypted: string): void {
    this.db
      .prepare(`UPDATE households SET hederaAccountId = ?, hederaPrivateKeyEncrypted = ? WHERE id = ?`)
      .run(hederaAccountId, hederaPrivateKeyEncrypted, id);
  }
}
