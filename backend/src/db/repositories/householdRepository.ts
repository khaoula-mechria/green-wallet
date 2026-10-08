import type { Database } from "better-sqlite3";
import type { Household, HouseholdSettings } from "../../domain/types.js";

/** Flat row as stored: settings live in their own columns, booleans as 0/1. */
type HouseholdRow = Omit<Household, "settings"> & {
  overflowMode: HouseholdSettings["overflowMode"];
  minSellPrice: number;
  maxBuyPrice: number;
  storeMinPrice: number;
  batterySellEnabled: number;
  batterySellMinPrice: number;
  batteryKeepPercent: number;
  auctionOptOut: number;
};

const COLUMNS = [
  "id", "name", "type", "location", "passwordHash", "hederaAccountId", "hederaPrivateKeyEncrypted",
  "energyType", "currentProduction", "currentConsumption", "batteryCapacityKwh", "batteryKwh", "storedKwh",
  "pendingSellKwh", "pendingBuyKwh",
  "overflowMode", "minSellPrice", "maxBuyPrice", "storeMinPrice", "batterySellEnabled", "batterySellMinPrice",
  "batteryKeepPercent", "auctionOptOut", "importedKwh", "importCost", "exportedKwh", "exportCredit",
  "consumedKwh", "consumedSolarKwh", "consumedWindKwh", "createdAt", "updatedAt",
];

export class HouseholdRepository {
  constructor(private readonly db: Database) {}

  insert(h: Household): void {
    this.db
      .prepare(`INSERT INTO households (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map((c) => "@" + c).join(", ")})`)
      .run(toRow(h));
  }

  findById(id: string): Household | undefined {
    const row = this.db.prepare(`SELECT * FROM households WHERE id = ?`).get(id) as HouseholdRow | undefined;
    return row ? toHousehold(row) : undefined;
  }

  findAll(): Household[] {
    return (this.db.prepare(`SELECT * FROM households ORDER BY name`).all() as HouseholdRow[]).map(toHousehold);
  }

  updateSnapshot(id: string, production: number, consumption: number, updatedAt: number): void {
    this.db
      .prepare(`UPDATE households SET currentProduction = ?, currentConsumption = ?, updatedAt = ? WHERE id = ?`)
      .run(production, consumption, updatedAt, id);
  }

  /** Moves energy in or out of the household's own battery and rented storage. */
  adjustStocks(id: string, deltaBatteryKwh: number, deltaStoredKwh: number, updatedAt: number): void {
    this.db
      .prepare(
        `UPDATE households
         SET batteryKwh = MAX(0, ROUND(batteryKwh + ?, 9)), storedKwh = MAX(0, ROUND(storedKwh + ?, 9)), updatedAt = ?
         WHERE id = ?`
      )
      .run(deltaBatteryKwh, deltaStoredKwh, updatedAt, id);
  }

  /** This interval's surplus / deficit waiting for the auction. */
  adjustPending(id: string, deltaSellKwh: number, deltaBuyKwh: number): void {
    this.db
      .prepare(
        `UPDATE households
         SET pendingSellKwh = MAX(0, ROUND(pendingSellKwh + ?, 9)), pendingBuyKwh = MAX(0, ROUND(pendingBuyKwh + ?, 9))
         WHERE id = ?`
      )
      .run(deltaSellKwh, deltaBuyKwh, id);
  }

  sumPendingSellKwh(): number {
    return (this.db.prepare(`SELECT COALESCE(SUM(pendingSellKwh), 0) AS total FROM households`).get() as { total: number }).total;
  }

  /** Utility statement lines (DESIGN.md §7.4): import debit / export credit. */
  addUtility(id: string, importedKwh: number, importCost: number, exportedKwh: number, exportCredit: number): void {
    this.db
      .prepare(
        `UPDATE households
         SET importedKwh = importedKwh + ?, importCost = importCost + ?, exportedKwh = exportedKwh + ?, exportCredit = exportCredit + ?
         WHERE id = ?`
      )
      .run(importedKwh, importCost, exportedKwh, exportCredit, id);
  }

  /** Adds one reading's consumption, split by the certificates retired for it. */
  addConsumption(id: string, totalKwh: number, solarKwh: number, windKwh: number): void {
    this.db
      .prepare(
        `UPDATE households
         SET consumedKwh = consumedKwh + ?, consumedSolarKwh = consumedSolarKwh + ?, consumedWindKwh = consumedWindKwh + ?
         WHERE id = ?`
      )
      .run(totalKwh, solarKwh, windKwh, id);
  }

  updateSettings(id: string, s: HouseholdSettings, updatedAt: number): void {
    this.db
      .prepare(
        `UPDATE households
         SET overflowMode = ?, minSellPrice = ?, maxBuyPrice = ?, storeMinPrice = ?, batterySellEnabled = ?,
             batterySellMinPrice = ?, batteryKeepPercent = ?, auctionOptOut = ?, updatedAt = ?
         WHERE id = ?`
      )
      .run(
        s.overflowMode,
        s.minSellPrice,
        s.maxBuyPrice,
        s.storeMinPrice,
        s.batterySell.enabled ? 1 : 0,
        s.batterySell.minPrice,
        s.batterySell.keepPercent,
        s.auctionOptOut ? 1 : 0,
        updatedAt,
        id
      );
  }

  sumStoredKwh(): number {
    return (this.db.prepare(`SELECT COALESCE(SUM(storedKwh), 0) AS total FROM households`).get() as { total: number }).total;
  }

  setHederaAccount(id: string, hederaAccountId: string, hederaPrivateKeyEncrypted: string): void {
    this.db
      .prepare(`UPDATE households SET hederaAccountId = ?, hederaPrivateKeyEncrypted = ? WHERE id = ?`)
      .run(hederaAccountId, hederaPrivateKeyEncrypted, id);
  }
}

function toHousehold(row: HouseholdRow): Household {
  const {
    overflowMode,
    minSellPrice,
    maxBuyPrice,
    storeMinPrice,
    batterySellEnabled,
    batterySellMinPrice,
    batteryKeepPercent,
    auctionOptOut,
    ...rest
  } = row;
  return {
    ...rest,
    settings: {
      overflowMode,
      minSellPrice,
      maxBuyPrice,
      storeMinPrice,
      batterySell: { enabled: batterySellEnabled === 1, minPrice: batterySellMinPrice, keepPercent: batteryKeepPercent },
      auctionOptOut: auctionOptOut === 1,
    },
  };
}

function toRow(h: Household): HouseholdRow {
  const { settings: s, ...rest } = h;
  return {
    ...rest,
    overflowMode: s.overflowMode,
    minSellPrice: s.minSellPrice,
    maxBuyPrice: s.maxBuyPrice,
    storeMinPrice: s.storeMinPrice,
    batterySellEnabled: s.batterySell.enabled ? 1 : 0,
    batterySellMinPrice: s.batterySell.minPrice,
    batteryKeepPercent: s.batterySell.keepPercent,
    auctionOptOut: s.auctionOptOut ? 1 : 0,
  };
}
