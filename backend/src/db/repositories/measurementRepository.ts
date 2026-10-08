import type { Database } from "better-sqlite3";
import type { EnergyFlow, EnergyMeasurement } from "../../domain/types.js";

interface MeasurementRow {
  id: string;
  householdId: string;
  timestamp: number;
  simTime: number;
  interval: number;
  source: EnergyMeasurement["source"];
  production: number;
  consumption: number;
  surplus: number;
  selfUseKwh: number;
  toBatteryKwh: number;
  toStorageKwh: number;
  fromBatteryKwh: number;
  fromStorageKwh: number;
  exportedKwh: number;
  importedKwh: number;
}

export class MeasurementRepository {
  constructor(private readonly db: Database) {}

  insert(m: EnergyMeasurement): void {
    const f = m.flow;
    this.db
      .prepare(
        `INSERT INTO energy_measurements
          (id, householdId, timestamp, simTime, interval, source, production, consumption, surplus,
           selfUseKwh, toBatteryKwh, toStorageKwh, fromBatteryKwh, fromStorageKwh, exportedKwh, importedKwh)
         VALUES (@id, @householdId, @timestamp, @simTime, @interval, @source, @production, @consumption, @surplus,
           @selfUseKwh, @toBatteryKwh, @toStorageKwh, @fromBatteryKwh, @fromStorageKwh, @exportedKwh, @importedKwh)`
      )
      .run({
        id: m.id,
        householdId: m.householdId,
        timestamp: m.timestamp,
        simTime: m.simTime,
        interval: m.interval,
        source: m.source,
        production: m.production,
        consumption: m.consumption,
        surplus: m.surplus,
        selfUseKwh: f.selfUse,
        toBatteryKwh: f.toBattery,
        toStorageKwh: f.toStorage,
        fromBatteryKwh: f.fromBattery,
        fromStorageKwh: f.fromStorage,
        exportedKwh: f.exported,
        importedKwh: f.imported,
      });
  }

  findByHousehold(householdId: string, limit = 100): EnergyMeasurement[] {
    return (
      this.db
        .prepare(`SELECT * FROM energy_measurements WHERE householdId = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?`)
        .all(householdId, limit) as MeasurementRow[]
    ).map(toMeasurement);
  }

  findAll(limit = 200): EnergyMeasurement[] {
    return (
      this.db.prepare(`SELECT * FROM energy_measurements ORDER BY timestamp DESC, rowid DESC LIMIT ?`).all(limit) as MeasurementRow[]
    ).map(toMeasurement);
  }

  sumProduction(): number {
    return (this.db.prepare(`SELECT COALESCE(SUM(production), 0) AS total FROM energy_measurements`).get() as { total: number }).total;
  }
}

function toMeasurement(r: MeasurementRow): EnergyMeasurement {
  const flow: EnergyFlow = {
    selfUse: r.selfUseKwh,
    toBattery: r.toBatteryKwh,
    toStorage: r.toStorageKwh,
    toAuction: 0,
    fromBattery: r.fromBatteryKwh,
    fromStorage: r.fromStorageKwh,
    toBuy: 0,
    sold: 0,
    exported: r.exportedKwh,
    bought: 0,
    imported: r.importedKwh,
    price: null,
    settled: true, // no auction yet: every reading settles immediately (Phase 2)
  };
  return {
    id: r.id,
    householdId: r.householdId,
    timestamp: r.timestamp,
    simTime: r.simTime,
    interval: r.interval,
    production: r.production,
    consumption: r.consumption,
    surplus: r.surplus,
    source: r.source,
    flow,
  };
}
