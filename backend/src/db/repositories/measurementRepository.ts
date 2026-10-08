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
  toAuctionKwh: number;
  fromBatteryKwh: number;
  fromStorageKwh: number;
  toBuyKwh: number;
  soldKwh: number;
  exportedKwh: number;
  boughtKwh: number;
  importedKwh: number;
  price: number | null;
  settled: number;
}

export interface IntervalOutcome {
  sold: number;
  exported: number;
  bought: number;
  imported: number;
}

export class MeasurementRepository {
  constructor(private readonly db: Database) {}

  insert(m: EnergyMeasurement): void {
    const f = m.flow;
    this.db
      .prepare(
        `INSERT INTO energy_measurements
          (id, householdId, timestamp, simTime, interval, source, production, consumption, surplus,
           selfUseKwh, toBatteryKwh, toStorageKwh, toAuctionKwh, fromBatteryKwh, fromStorageKwh, toBuyKwh,
           soldKwh, exportedKwh, boughtKwh, importedKwh, price, settled)
         VALUES (@id, @householdId, @timestamp, @simTime, @interval, @source, @production, @consumption, @surplus,
           @selfUseKwh, @toBatteryKwh, @toStorageKwh, @toAuctionKwh, @fromBatteryKwh, @fromStorageKwh, @toBuyKwh,
           @soldKwh, @exportedKwh, @boughtKwh, @importedKwh, @price, @settled)`
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
        toAuctionKwh: f.toAuction,
        fromBatteryKwh: f.fromBattery,
        fromStorageKwh: f.fromStorage,
        toBuyKwh: f.toBuy,
        soldKwh: f.sold,
        exportedKwh: f.exported,
        boughtKwh: f.bought,
        importedKwh: f.imported,
        price: f.price,
        settled: f.settled ? 1 : 0,
      });
  }

  /**
   * Marks a household's readings of an interval as settled at `price`, and adds the
   * auction outcome to the latest of them (DESIGN.md §4.3).
   */
  settleInterval(householdId: string, interval: number, price: number | null, outcome: IntervalOutcome): void {
    this.db
      .prepare(`UPDATE energy_measurements SET settled = 1, price = ? WHERE householdId = ? AND interval = ?`)
      .run(price, householdId, interval);
    const latest = this.db
      .prepare(`SELECT id FROM energy_measurements WHERE householdId = ? AND interval = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1`)
      .get(householdId, interval) as { id: string } | undefined;
    if (!latest) return;
    this.db
      .prepare(
        `UPDATE energy_measurements
         SET soldKwh = soldKwh + ?, exportedKwh = exportedKwh + ?, boughtKwh = boughtKwh + ?, importedKwh = importedKwh + ?
         WHERE id = ?`
      )
      .run(round3(outcome.sold), round3(outcome.exported), round3(outcome.bought), round3(outcome.imported), latest.id);
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
    toAuction: r.toAuctionKwh,
    fromBattery: r.fromBatteryKwh,
    fromStorage: r.fromStorageKwh,
    toBuy: r.toBuyKwh,
    sold: r.soldKwh,
    exported: r.exportedKwh,
    bought: r.boughtKwh,
    imported: r.importedKwh,
    price: r.price,
    settled: r.settled === 1,
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
