import type { Database } from "better-sqlite3";
import type { EnergyMeasurement } from "../../domain/types.js";
import { whToKwh } from "../../domain/units.js";

interface MeasurementRow {
  id: string;
  householdId: string;
  timestamp: number;
  productionWh: number;
  consumptionWh: number;
  surplusWh: number;
}

function toDomain(r: MeasurementRow): EnergyMeasurement {
  return {
    id: r.id,
    householdId: r.householdId,
    timestamp: r.timestamp,
    production: whToKwh(r.productionWh),
    consumption: whToKwh(r.consumptionWh),
    surplus: whToKwh(r.surplusWh),
  };
}

export class MeasurementRepository {
  constructor(private readonly db: Database) {}

  insert(m: { id: string; householdId: string; timestamp: number; productionWh: number; consumptionWh: number }): EnergyMeasurement {
    const row: MeasurementRow = { ...m, surplusWh: m.productionWh - m.consumptionWh };
    this.db
      .prepare(
        `INSERT INTO energy_measurements (id, householdId, timestamp, productionWh, consumptionWh, surplusWh)
         VALUES (@id, @householdId, @timestamp, @productionWh, @consumptionWh, @surplusWh)`
      )
      .run(row);
    return toDomain(row);
  }

  findByHousehold(householdId: string, limit = 100): EnergyMeasurement[] {
    return (
      this.db
        .prepare(`SELECT * FROM energy_measurements WHERE householdId = ? ORDER BY timestamp DESC LIMIT ?`)
        .all(householdId, limit) as MeasurementRow[]
    ).map(toDomain);
  }

  findAll(limit = 200): EnergyMeasurement[] {
    return (
      this.db.prepare(`SELECT * FROM energy_measurements ORDER BY timestamp DESC LIMIT ?`).all(limit) as MeasurementRow[]
    ).map(toDomain);
  }
}
