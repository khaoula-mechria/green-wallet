import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { MeasurementRepository } from "../db/repositories/measurementRepository.js";
import { AccountRepository } from "../db/repositories/accountRepository.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import type { Account, Household, HouseholdSettings, HouseholdType, PublicHousehold } from "../domain/types.js";
import { priceBand } from "../config/env.js";
import type { GridService } from "./gridService.js";

/** Default agent settings (DESIGN.md §4.1): sell from the floor, buy up to the ceiling
 * ("always beat the utility"), wait for mid-band with stored energy, battery selling off. */
export function defaultSettings(): HouseholdSettings {
  const band = priceBand();
  return {
    overflowMode: "sell",
    minSellPrice: band.floor,
    maxBuyPrice: band.ceiling,
    storeMinPrice: band.mid,
    batterySell: { enabled: false, minPrice: round3(band.ceiling - 0.05), keepPercent: 20 },
    auctionOptOut: false,
  };
}

export type SettingsPatch = Partial<Omit<HouseholdSettings, "batterySell">> & {
  batterySell?: Partial<HouseholdSettings["batterySell"]>;
};

/** Merges and validates settings for a household of the given role and battery size. */
export function resolveSettings(
  base: HouseholdSettings,
  patch: SettingsPatch,
  type: HouseholdType,
  batteryCapacityKwh: number
): HouseholdSettings {
  const next: HouseholdSettings = {
    ...base,
    ...patch,
    batterySell: { ...base.batterySell, ...patch.batterySell },
  };
  const band = priceBand();
  const inBand = (name: string, p: number) => {
    if (!Number.isFinite(p) || p < band.floor || p > band.ceiling) {
      throw new ValidationError(`${name} must be between the floor ${band.floor.toFixed(2)} and the ceiling ${band.ceiling.toFixed(2)} TEC/kWh`);
    }
  };
  inBand("minimum sell price", next.minSellPrice);
  inBand("maximum buy price", next.maxBuyPrice);
  inBand("stored-energy minimum price", next.storeMinPrice);
  inBand("battery sell price", next.batterySell.minPrice);
  if (!(next.batterySell.keepPercent >= 0 && next.batterySell.keepPercent <= 100)) {
    throw new ValidationError("battery reserve must be between 0 and 100%");
  }
  if (next.overflowMode !== "sell" && next.overflowMode !== "store") throw new ValidationError("overflow mode must be sell or store");
  // Only prosumers have an overflow choice; battery selling needs a battery.
  if (type !== "prosumer") next.overflowMode = "sell";
  if (type !== "prosumer" || batteryCapacityKwh === 0) next.batterySell.enabled = false;
  return next;
}

export class HouseholdService {
  private readonly households: HouseholdRepository;
  private readonly measurements: MeasurementRepository;
  private readonly accounts: AccountRepository;

  constructor(db: Database, private readonly grid: GridService) {
    this.households = new HouseholdRepository(db);
    this.measurements = new MeasurementRepository(db);
    this.accounts = new AccountRepository(db);
  }

  getAll(): PublicHousehold[] {
    const byHousehold = new Map(this.accounts.findByKind("household").map((a) => [a.householdId, a]));
    return this.households.findAll().map((h) => this.toPublic(h, byHousehold.get(h.id)));
  }

  getById(id: string): PublicHousehold {
    const h = this.households.findById(id);
    if (!h) throw new NotFoundError("Household");
    return this.toPublic(h, this.accounts.findByHouseholdId(id));
  }

  getHistory(id: string, limit = 50) {
    if (!this.households.findById(id)) throw new NotFoundError("Household");
    return this.measurements.findByHousehold(id, limit);
  }

  getSettings(id: string): HouseholdSettings {
    const h = this.households.findById(id);
    if (!h) throw new NotFoundError("Household");
    return h.settings;
  }

  updateSettings(id: string, patch: SettingsPatch): HouseholdSettings {
    const h = this.households.findById(id);
    if (!h) throw new NotFoundError("Household");
    const next = resolveSettings(h.settings, patch, h.type, h.batteryCapacityKwh);
    this.households.updateSettings(id, next, Date.now());
    return next;
  }

  /** API shape (contract: Household in frontend/src/types.ts). */
  private toPublic(h: Household, account: Account | undefined): PublicHousehold {
    return {
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      energyType: h.energyType,
      accountId: account?.id ?? null,
      currentProduction: h.currentProduction,
      currentConsumption: h.currentConsumption,
      batteryCapacityKwh: h.batteryCapacityKwh,
      batteryChargeKwh: round3(h.batteryKwh),
      storedKwh: round3(h.storedKwh),
      reservedInOffersKwh: round3(this.grid.reservedInOffers(h.id)),
      listableKwh: round3(this.grid.listable(h)),
      storageSpaceKwh: round3(this.grid.storageSpace(h)),
      tokenBalance: round2(account?.balance ?? 0),
      reservedTec: round2(account?.reservedBalance ?? 0),
      settings: h.settings,
      createdAt: h.createdAt,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
