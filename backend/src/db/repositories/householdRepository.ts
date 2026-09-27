import type { Database } from "better-sqlite3";
import type { Household, HouseholdType } from "../../domain/types.js";
import { microToTec, whToKwh } from "../../domain/units.js";

interface HouseholdRow {
  id: string;
  name: string;
  type: HouseholdType;
  location: string;
  passwordHash: string;
  hederaAccountId: string | null;
  hederaPrivateKeyEncrypted: string | null;
  energyType: string;
  currentProductionWh: number;
  currentConsumptionWh: number;
  energyBalanceWh: number;
  tokenBalanceMicro: number;
  createdAt: number;
  updatedAt: number;
}

export type NewHousehold = Omit<
  Household,
  "currentProduction" | "currentConsumption" | "energyBalance" | "tokenBalance"
>;

function toDomain(r: HouseholdRow): Household {
  const { currentProductionWh, currentConsumptionWh, energyBalanceWh, tokenBalanceMicro, ...rest } = r;
  return {
    ...rest,
    currentProduction: whToKwh(currentProductionWh),
    currentConsumption: whToKwh(currentConsumptionWh),
    energyBalance: whToKwh(energyBalanceWh),
    tokenBalance: microToTec(tokenBalanceMicro),
  };
}

/** Balance mutations are expressed as SQL deltas, never read-modify-write, and
 * debits are conditional: they report `false` instead of overdrawing. The
 * schema's CHECK (balance >= 0) is the last line of defence behind that. */
export class HouseholdRepository {
  constructor(private readonly db: Database) {}

  /** Inserts with zero balances: starting TEC is issued via TokenService so it
   * is always backed by a ledger record. */
  insert(h: NewHousehold): void {
    this.db
      .prepare(
        `INSERT INTO households
          (id, name, type, location, passwordHash, hederaAccountId, hederaPrivateKeyEncrypted, energyType, createdAt, updatedAt)
         VALUES (@id, @name, @type, @location, @passwordHash, @hederaAccountId, @hederaPrivateKeyEncrypted, @energyType, @createdAt, @updatedAt)`
      )
      .run(h);
  }

  findById(id: string): Household | undefined {
    const row = this.db.prepare(`SELECT * FROM households WHERE id = ?`).get(id) as HouseholdRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  exists(id: string): boolean {
    return this.db.prepare(`SELECT 1 FROM households WHERE id = ?`).get(id) !== undefined;
  }

  findAll(): Household[] {
    return (this.db.prepare(`SELECT * FROM households ORDER BY name`).all() as HouseholdRow[]).map(toDomain);
  }

  updateSnapshot(id: string, productionWh: number, consumptionWh: number, updatedAt: number): void {
    this.db
      .prepare(`UPDATE households SET currentProductionWh = ?, currentConsumptionWh = ?, updatedAt = ? WHERE id = ?`)
      .run(productionWh, consumptionWh, updatedAt, id);
  }

  creditEnergy(id: string, wh: number, updatedAt: number): void {
    this.db.prepare(`UPDATE households SET energyBalanceWh = energyBalanceWh + ?, updatedAt = ? WHERE id = ?`).run(wh, updatedAt, id);
  }

  /** @returns false (and changes nothing) if the balance is insufficient. */
  debitEnergy(id: string, wh: number, updatedAt: number): boolean {
    return (
      this.db
        .prepare(`UPDATE households SET energyBalanceWh = energyBalanceWh - ?, updatedAt = ? WHERE id = ? AND energyBalanceWh >= ?`)
        .run(wh, updatedAt, id, wh).changes === 1
    );
  }

  creditTokens(id: string, micro: number, updatedAt: number): void {
    this.db.prepare(`UPDATE households SET tokenBalanceMicro = tokenBalanceMicro + ?, updatedAt = ? WHERE id = ?`).run(micro, updatedAt, id);
  }

  /** @returns false (and changes nothing) if the balance is insufficient. */
  debitTokens(id: string, micro: number, updatedAt: number): boolean {
    return (
      this.db
        .prepare(`UPDATE households SET tokenBalanceMicro = tokenBalanceMicro - ?, updatedAt = ? WHERE id = ? AND tokenBalanceMicro >= ?`)
        .run(micro, updatedAt, id, micro).changes === 1
    );
  }

  setHederaAccount(id: string, hederaAccountId: string, hederaPrivateKeyEncrypted: string): void {
    this.db
      .prepare(`UPDATE households SET hederaAccountId = ?, hederaPrivateKeyEncrypted = ? WHERE id = ?`)
      .run(hederaAccountId, hederaPrivateKeyEncrypted, id);
  }

  /** Exact system-wide sums, in integer units. */
  totals(): { productionWh: number; consumptionWh: number; tokenBalanceMicro: number } {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(currentProductionWh), 0) AS productionWh,
                COALESCE(SUM(currentConsumptionWh), 0) AS consumptionWh,
                COALESCE(SUM(tokenBalanceMicro), 0) AS tokenBalanceMicro
         FROM households`
      )
      .get() as { productionWh: number; consumptionWh: number; tokenBalanceMicro: number };
  }
}
