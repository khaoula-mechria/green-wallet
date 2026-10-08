import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { MeasurementRepository } from "../db/repositories/measurementRepository.js";
import type { CertificateAmounts, CertificateAsset, EnergyFlow, EnergyMeasurement, LedgerTransaction } from "../domain/types.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { UTILITY_ACCOUNT, type LedgerService } from "./ledgerService.js";
import type { CertificateService } from "./certificateService.js";
import type { GridService } from "./gridService.js";
import type { ClockService } from "./clockService.js";
import type { AuctionService } from "./auctionService.js";
import { env, priceBand } from "../config/env.js";

export interface RecordMeasurementResult {
  measurement: EnergyMeasurement;
  /** Real ms until what's waiting for the auction settles (0 when nothing is). */
  settlesInMs: number;
  /** Certificates issued for this reading's production (null when nothing was produced). */
  certificateTx: LedgerTransaction | null;
  /** Certificates retired for this reading's consumption. */
  retired: CertificateAmounts;
}

/**
 * Physical-energy-layer entry point (docs/DESIGN.md §1, §2, §5). Production earns
 * green certificates, never TEC. Within one reading:
 *  1. all production is certified; what's consumed on the spot is retired at once;
 *  2. surplus: own battery → rented storage (store mode) → waits for the auction;
 *  3. deficit: own battery → own stored energy (retiring their certificates) →
 *     waits for the auction, with the TEC to pay for it reserved.
 * Steps 1–3 happen now; the auction settles the rest at the end of the interval
 * (AuctionService), sending what doesn't match to export / import. A household
 * that opted out of the auction exports / imports immediately.
 */
export class MeasurementService {
  private readonly households: HouseholdRepository;
  private readonly measurements: MeasurementRepository;

  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly certificates: CertificateService,
    private readonly grid: GridService,
    private readonly clock: ClockService,
    private readonly auction: AuctionService
  ) {
    this.households = new HouseholdRepository(db);
    this.measurements = new MeasurementRepository(db);
  }

  async record(
    householdId: string,
    production: number,
    consumption: number,
    source: EnergyMeasurement["source"] = "simulation",
    timestamp: number = Date.now()
  ): Promise<RecordMeasurementResult> {
    if (!Number.isFinite(production) || !Number.isFinite(consumption)) {
      throw new ValidationError("production/consumption must be finite numbers");
    }
    if (production < 0 || consumption < 0) throw new ValidationError("production/consumption must be >= 0");
    // Production is certified, so an unbounded reading would issue unbounded certificates.
    if (production > env.measurementMaxKwh || consumption > env.measurementMaxKwh) {
      throw new ValidationError(`production/consumption must be <= ${env.measurementMaxKwh} kWh per reading`);
    }
    if (!this.households.findById(householdId)) throw new NotFoundError("Household");

    const run = this.db.transaction(() => {
      const h = this.households.findById(householdId)!;
      if (h.type === "consumer" && production > 0) throw new ValidationError("consumers do not produce energy");

      const accountId = this.ledger.getHouseholdAccount(householdId).id;
      const src: CertificateAsset = h.energyType === "wind" ? "WIND" : "SOLAR";
      const band = priceBand();
      const surplus = Number((production - consumption).toFixed(4));
      const flow = emptyFlow();

      const certificateTx =
        production > 0 ? this.ledger.issueCertificate(accountId, src, production, `Green certificate for ${production.toFixed(2)} kWh produced`) : null;

      const selfUse = Math.min(production, consumption);
      flow.selfUse = selfUse;
      const retired: CertificateAmounts = { solar: src === "SOLAR" ? selfUse : 0, wind: src === "WIND" ? selfUse : 0 };

      if (surplus > 0) {
        let rest = surplus;
        if (h.type === "prosumer") {
          flow.toBattery = Math.min(rest, Math.max(0, h.batteryCapacityKwh - h.batteryKwh));
          rest -= flow.toBattery;
          if (h.settings.overflowMode === "store") {
            flow.toStorage = Math.min(rest, this.grid.storageSpace(h));
            rest -= flow.toStorage;
          }
          this.households.adjustStocks(householdId, flow.toBattery, flow.toStorage, timestamp);
        }
        if (rest > 1e-9 && h.settings.auctionOptOut) {
          // Opted out: the fresh surplus that fits nowhere is exported now, with its own certificates.
          flow.exported = rest;
          this.households.addUtility(householdId, 0, 0, rest, rest * band.floor);
          const held = this.ledger.getCertificates(accountId)[src === "SOLAR" ? "solar" : "wind"];
          this.ledger.transferCertificate(accountId, UTILITY_ACCOUNT, src, Math.min(rest, held), "Certificates handed over with exported energy");
        } else if (rest > 1e-9) {
          flow.toAuction = rest;
          this.households.adjustPending(householdId, rest, 0);
        }
      } else if (surplus < 0) {
        const need = -surplus;
        flow.fromBattery = Math.min(need, h.batteryKwh);
        flow.fromStorage = Math.min(need - flow.fromBattery, h.storedKwh);
        const fromStock = flow.fromBattery + flow.fromStorage;
        if (fromStock > 0) {
          const share = this.certificates.shareOf(householdId, fromStock); // before the stock shrinks
          this.households.adjustStocks(householdId, -flow.fromBattery, -flow.fromStorage, timestamp);
          retired.solar += share.solar;
          retired.wind += share.wind;
          this.grid.shrinkOffers(householdId); // the deficit may have used listed kWh
        }
        const missing = need - fromStock;
        if (missing > 1e-9 && h.settings.auctionOptOut) {
          flow.imported = missing; // opted out: the utility supplies it now
          this.households.addUtility(householdId, missing, missing * band.ceiling, 0, 0);
        } else if (missing > 1e-9) {
          flow.toBuy = missing;
          this.households.adjustPending(householdId, 0, missing);
          this.auction.updateReservation(householdId);
        }
      }

      // Never retire more than is held (the ledger works in 0.01 kWh steps).
      const held = this.ledger.getCertificates(accountId);
      const solarTx = this.ledger.retireCertificate(accountId, "SOLAR", Math.min(retired.solar, held.solar), "Green energy consumed");
      const windTx = this.ledger.retireCertificate(accountId, "WIND", Math.min(retired.wind, held.wind), "Green energy consumed");
      const actual = { solar: solarTx?.amount ?? 0, wind: windTx?.amount ?? 0 };
      // Consumption counts once it is supplied; what waits for the auction is counted when it settles.
      this.households.addConsumption(householdId, consumption - flow.toBuy, actual.solar, actual.wind);
      this.households.updateSnapshot(householdId, production, consumption, timestamp);

      const measurement: EnergyMeasurement = {
        id: uuid(),
        householdId,
        timestamp,
        simTime: this.clock.simTime(),
        interval: this.clock.interval(),
        production,
        consumption,
        surplus,
        source,
        flow: roundFlow({ ...flow, settled: flow.toAuction === 0 && flow.toBuy === 0 }),
      };
      this.measurements.insert(measurement);
      const settlesInMs = measurement.flow.settled ? 0 : this.clock.msUntilNextInterval();
      return { measurement, settlesInMs, certificateTx, retired: actual };
    });

    return run();
  }

  getRecent(limit = 100): EnergyMeasurement[] {
    return this.measurements.findAll(limit);
  }

  getForHousehold(householdId: string, limit = 50): EnergyMeasurement[] {
    if (!this.households.findById(householdId)) throw new NotFoundError("Household");
    return this.measurements.findByHousehold(householdId, limit);
  }
}

function emptyFlow(): EnergyFlow {
  return {
    selfUse: 0,
    toBattery: 0,
    toStorage: 0,
    toAuction: 0,
    fromBattery: 0,
    fromStorage: 0,
    toBuy: 0,
    sold: 0,
    exported: 0,
    bought: 0,
    imported: 0,
    price: null,
    settled: true,
  };
}

function roundFlow(f: EnergyFlow): EnergyFlow {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    ...f,
    selfUse: r(f.selfUse),
    toBattery: r(f.toBattery),
    toStorage: r(f.toStorage),
    toAuction: r(f.toAuction),
    toBuy: r(f.toBuy),
    fromBattery: r(f.fromBattery),
    fromStorage: r(f.fromStorage),
    exported: r(f.exported),
    imported: r(f.imported),
  };
}
