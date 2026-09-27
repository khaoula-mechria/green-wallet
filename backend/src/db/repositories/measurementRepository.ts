import type { Database } from "better-sqlite3";
import type { EnergyMeasurement } from "../../domain/types.js";

export class MeasurementRepository {
  constructor(private readonly db: Database) {}

  insert(m: EnergyMeasurement): void {
    this.db
      .prepare(
        `INSERT INTO energy_measurements (id, householdId, timestamp, production, consumption, surplus)
         VALUES (@id, @householdId, @timestamp, @production, @consumption, @surplus)`
      )
      .run(m);
  }

  findByHousehold(householdId: string, limit = 100): EnergyMeasurement[] {
    return this.db
      .prepare(
        `SELECT * FROM energy_measurements WHERE householdId = ? ORDER BY timestamp DESC LIMIT ?`
      )
      .all(householdId, limit) as EnergyMeasurement[];
  }

  findAll(limit = 200): EnergyMeasurement[] {
    return this.db
      .prepare(`SELECT * FROM energy_measurements ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as EnergyMeasurement[];
  }

  latestForHousehold(householdId: string): EnergyMeasurement | undefined {
    return this.db
      .prepare(`SELECT * FROM energy_measurements WHERE householdId = ? ORDER BY timestamp DESC LIMIT 1`)
      .get(householdId) as EnergyMeasurement | undefined;
  }
}
