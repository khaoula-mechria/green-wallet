import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { CertificateAmounts, GreenShare, Household } from "../domain/types.js";
import { NotFoundError } from "../utils/errors.js";
import type { LedgerService } from "./ledgerService.js";

const NONE: CertificateAmounts = { solar: 0, wind: 0 };

/**
 * Certificates follow the kWh (docs/DESIGN.md §2.3). A household's energy stock
 * is its own battery, its rented space in the shared battery and this interval's
 * surplus waiting for the auction; its certificates back that whole stock, so
 * moving X kWh out of it moves X / stock of each certificate type. (One
 * certificate pool per household.) Listed offers don't move energy, they
 * reserve part of the stock, so they don't change the stock either.
 */
export class CertificateService {
  private readonly households: HouseholdRepository;

  constructor(db: Database, private readonly ledger: LedgerService) {
    this.households = new HouseholdRepository(db);
  }

  stockKwh(householdId: string): number {
    const h = this.households.findById(householdId);
    if (!h) throw new NotFoundError("Household");
    return h.batteryKwh + h.storedKwh + h.pendingSellKwh;
  }

  /** Certificates that travel with `kwh` taken out of the household's stock. Call it
   * before the stock changes. */
  shareOf(householdId: string, kwh: number): CertificateAmounts {
    const held = this.ledger.getCertificates(this.ledger.getHouseholdAccount(householdId).id);
    if (kwh <= 0 || held.solar + held.wind <= 0) return { ...NONE };

    const stock = this.stockKwh(householdId);
    // The whole stock leaves: so do all its certificates (no sub-0.01 dust left behind).
    if (stock <= 0 || kwh >= stock - 0.005) return held;

    const f = kwh / stock;
    return {
      solar: Math.min(held.solar, round2(held.solar * f)),
      wind: Math.min(held.wind, round2(held.wind * f)),
    };
  }
}

/** Green share of consumption: energy backed by retired certificates vs grey energy. */
export function greenShareOf(consumers: Array<Pick<Household, "consumedKwh" | "consumedSolarKwh" | "consumedWindKwh">>): GreenShare {
  let total = 0;
  let solar = 0;
  let wind = 0;
  for (const h of consumers) {
    total += h.consumedKwh;
    solar += h.consumedSolarKwh;
    wind += h.consumedWindKwh;
  }
  const grey = Math.max(0, total - solar - wind);
  return {
    solarKwh: round2(solar),
    windKwh: round2(wind),
    greyKwh: round2(grey),
    percentGreen: total > 0 ? Math.round(((solar + wind) / total) * 100) : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
