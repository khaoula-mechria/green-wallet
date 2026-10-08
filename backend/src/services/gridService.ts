import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { OfferRepository } from "../db/repositories/offerRepository.js";
import { MeasurementRepository } from "../db/repositories/measurementRepository.js";
import { GridStorageRepository } from "../db/repositories/gridStorageRepository.js";
import type { Household, SharedBatteryStatus } from "../domain/types.js";
import { env, priceBand } from "../config/env.js";
import { NotFoundError } from "../utils/errors.js";
import { GRID_STORAGE_ACCOUNT, type LedgerService } from "./ledgerService.js";
import type { CertificateService } from "./certificateService.js";
import type { ClockService } from "./clockService.js";

const MIN_STORED_KWH = 0.01;
const EPS = 1e-9;

/**
 * The community battery and the households' energy stocks (docs/DESIGN.md §1, §6, §8):
 *  - capacity split: a rented compartment (households, capped per household) and
 *    the operator's grid pool;
 *  - what a household can still receive, and what it can list for sale;
 *  - the storage fee: stored kWh decay into the grid pool every simulated hour;
 *  - offers never advertise energy that no longer exists (they shrink);
 *  - the energy conservation check (§9.3).
 */
export class GridService {
  private readonly households: HouseholdRepository;
  private readonly offers: OfferRepository;
  private readonly measurements: MeasurementRepository;
  private readonly storage: GridStorageRepository;

  constructor(
    db: Database,
    private readonly ledger: LedgerService,
    private readonly certificates: CertificateService,
    private readonly clock: ClockService
  ) {
    this.households = new HouseholdRepository(db);
    this.offers = new OfferRepository(db);
    this.measurements = new MeasurementRepository(db);
    this.storage = new GridStorageRepository(db);
    // Pre-charged from the utility (grey energy) so the first evening has something to sell (§6.5).
    this.storage.ensure(this.poolCapacityKwh() * env.gridPoolInitialShare);
  }

  rentedCapacityKwh(): number {
    return env.sharedBatteryCapacityKwh * env.sharedBatteryRentedShare;
  }

  poolCapacityKwh(): number {
    return env.sharedBatteryCapacityKwh - this.rentedCapacityKwh();
  }

  rentedFreeKwh(): number {
    return Math.max(0, this.rentedCapacityKwh() - this.households.sumStoredKwh());
  }

  /** What the household can still receive into its rented space (cap and community limits). */
  storageSpace(h: Household): number {
    return Math.max(0, Math.min(env.rentedCapPerHouseholdKwh - h.storedKwh, this.rentedFreeKwh()));
  }

  reservedInOffers(householdId: string): number {
    return this.offers.sumActiveRemainingBySeller(householdId);
  }

  /** "You can only sell what you own now" (§8.2): stored energy plus battery above the keep-reserve. */
  listable(h: Household): number {
    if (h.type === "producer") return 0;
    const keep = (h.settings.batterySell.keepPercent / 100) * h.batteryCapacityKwh;
    const fromBattery = Math.max(0, h.batteryKwh - keep);
    return Math.max(0, h.storedKwh + fromBattery - this.reservedInOffers(h.id));
  }

  /** Offers can never advertise energy that no longer exists (§1, §8.3): the newest shrink first. */
  shrinkOffers(householdId: string): void {
    const h = this.households.findById(householdId);
    if (!h) throw new NotFoundError("Household");
    let excess = this.reservedInOffers(householdId) - (h.batteryKwh + h.storedKwh);
    if (excess <= EPS) return;

    const now = Date.now();
    for (const o of this.offers.findBySeller(householdId)) {
      if (excess <= EPS) break;
      if (o.status !== "active") continue;
      const cut = Math.min(o.amountRemainingKwh, excess);
      const remaining = round4(o.amountRemainingKwh - cut);
      excess -= cut;
      if (remaining < 0.01) this.offers.updateRemainingAndStatus(o.id, 0, "cancelled", now);
      else this.offers.updateRemainingAndStatus(o.id, remaining, "active", now);
    }
  }

  /** Seed only: demo batteries start half full with grey energy, counted as initial stock. */
  injectInitialCharge(householdId: string, kwh: number): void {
    const h = this.households.findById(householdId);
    if (!h) throw new NotFoundError("Household");
    const charge = Math.min(kwh, Math.max(0, h.batteryCapacityKwh - h.batteryKwh));
    if (charge <= 0) return;
    this.households.adjustStocks(householdId, charge, 0, Date.now());
    this.storage.addInitialStock(charge);
  }

  /**
   * Storage fee for one interval (§6.2): stored kWh shrink by STORAGE_DECAY_PER_SIM_HOUR
   * per simulated hour. The decayed kWh go to the grid pool (grey: their certificates
   * are retired as a loss); whatever the full pool can't take is exported by the operator.
   */
  applyDecay(): { decayedKwh: number } {
    const factor = Math.pow(1 - env.storageDecayPerSimHour, this.clock.minutesPerInterval() / 60);
    const now = Date.now();
    let decayedKwh = 0;

    for (const h of this.households.findAll()) {
      if (h.storedKwh <= 0) continue;
      let lost = h.storedKwh * (1 - factor);
      if (h.storedKwh - lost < MIN_STORED_KWH) lost = h.storedKwh;
      if (lost <= 0) continue;

      const share = this.certificates.shareOf(h.id, lost); // before the stock shrinks
      this.households.adjustStocks(h.id, 0, -lost, now);
      const accountId = this.ledger.getHouseholdAccount(h.id).id;
      this.ledger.retireCertificate(accountId, "SOLAR", share.solar, "Storage losses (decay)");
      this.ledger.retireCertificate(accountId, "WIND", share.wind, "Storage losses (decay)");
      this.shrinkOffers(h.id);

      const room = Math.max(0, this.poolCapacityKwh() - this.storage.get().poolKwh);
      const toPool = Math.min(lost, room);
      this.storage.adjustPool(toPool);
      if (lost - toPool > 0) this.storage.addOperatorExport(lost - toPool);
      decayedKwh += lost;
    }
    return { decayedKwh };
  }

  status(): SharedBatteryStatus {
    const band = priceBand();
    // No auction history until Phase 3: the 24h average is the middle of the band (§6.4).
    const avg24h = band.mid;
    const clamp = (p: number) => Math.min(band.ceiling, Math.max(band.floor, Math.round(p * 1000) / 1000));
    const pool = this.storage.get();
    const greenPool = this.ledger.getCertificates(GRID_STORAGE_ACCOUNT);
    return {
      capacityKwh: env.sharedBatteryCapacityKwh,
      rented: {
        capacityKwh: round2(this.rentedCapacityKwh()),
        usedKwh: round2(this.households.sumStoredKwh()),
        households: this.households.findAll().filter((h) => h.storedKwh > 0.001).length,
        capPerHouseholdKwh: env.rentedCapPerHouseholdKwh,
      },
      gridPool: {
        capacityKwh: round2(this.poolCapacityKwh()),
        chargeKwh: round2(pool.poolKwh),
        greenKwh: round2(greenPool.solar + greenPool.wind),
      },
      decayPerHour: env.storageDecayPerSimHour,
      avg24h,
      gridBuysBelow: clamp(avg24h * env.gridPoolBuyBelowAvg),
      gridSellsAbove: clamp(avg24h * env.gridPoolSellAboveAvg),
    };
  }

  /** §9.3: initial stock + produced + imported = consumed + exported + everything stored. */
  checkEnergy(): { ok: boolean; inputs: number; outputs: number } {
    const all = this.households.findAll();
    const pool = this.storage.get();
    const sum = (f: (h: Household) => number) => all.reduce((s, h) => s + f(h), 0);

    const inputs = pool.initialStockKwh + this.measurements.sumProduction() + sum((h) => h.importedKwh);
    const stocks = sum((h) => h.batteryKwh + h.storedKwh) + pool.poolKwh;
    const outputs = sum((h) => h.consumedKwh) + sum((h) => h.exportedKwh) + pool.operatorExportedKwh + stocks;
    return { ok: Math.abs(inputs - outputs) < Math.max(0.01, inputs * 1e-6), inputs: round2(inputs), outputs: round2(outputs) };
  }

  noNegativeStocks(): boolean {
    return this.households.findAll().every((h) => h.batteryKwh >= -EPS && h.storedKwh >= -EPS) && this.storage.get().poolKwh >= -EPS;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
