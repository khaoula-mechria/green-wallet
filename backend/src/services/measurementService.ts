import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { MeasurementRepository } from "../db/repositories/measurementRepository.js";
import { atomic } from "../db/transaction.js";
import type { EnergyMeasurement, TokenTransaction } from "../domain/types.js";
import { MICRO_PER_WH_MINTED, kwhToWh } from "../domain/units.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import type { TokenService } from "./tokenService.js";
import { env } from "../config/env.js";

export interface RecordMeasurementResult {
  measurement: EnergyMeasurement;
  mintTx: TokenTransaction | null;
}

/**
 * Physical-energy-layer entry point: records what a household's meter
 * reported (production/consumption in kWh) and derives surplus/deficit.
 * A positive surplus is immediately tokenized (surplus kWh -> TEC) via
 * TokenService — this is the "surplus calculation -> blockchain/token
 * system" step of the pipeline described in the spec. The reading and its
 * mint commit together: there is never a reading without its tokens, or
 * tokens without their reading.
 */
export class MeasurementService {
  private readonly households: HouseholdRepository;
  private readonly measurements: MeasurementRepository;

  constructor(private readonly db: Database, private readonly tokenService: TokenService) {
    this.households = new HouseholdRepository(db);
    this.measurements = new MeasurementRepository(db);
  }

  async record(
    householdId: string,
    production: number,
    consumption: number,
    timestamp: number = Date.now()
  ): Promise<RecordMeasurementResult> {
    if (!Number.isFinite(production) || !Number.isFinite(consumption)) {
      throw new ValidationError("production/consumption must be finite numbers");
    }
    if (production < 0 || consumption < 0) throw new ValidationError("production/consumption must be >= 0");
    // Surplus is minted 1:1 into TEC, so an unbounded reading would be an
    // unbounded mint. Cap every reading at a plausible per-interval maximum.
    if (production > env.measurementMaxKwh || consumption > env.measurementMaxKwh) {
      throw new ValidationError(`production/consumption must be <= ${env.measurementMaxKwh} kWh per reading`);
    }
    const productionWh = kwhToWh(production, "production");
    const consumptionWh = kwhToWh(consumption, "consumption");

    return atomic(this.db, () => {
      if (!this.households.exists(householdId)) throw new NotFoundError("Household");

      const measurement = this.measurements.insert({ id: uuid(), householdId, timestamp, productionWh, consumptionWh });
      this.households.updateSnapshot(householdId, productionWh, consumptionWh, timestamp);

      const surplusWh = productionWh - consumptionWh;
      const mintTx =
        surplusWh > 0
          ? this.tokenService.issueInTx("MINT", householdId, surplusWh * MICRO_PER_WH_MINTED, { reason: "energy-surplus-tokenization", measurementId: measurement.id }, surplusWh)
          : null;

      return { measurement, mintTx };
    });
  }

  getRecent(limit = 100): EnergyMeasurement[] {
    return this.measurements.findAll(limit);
  }

  getForHousehold(householdId: string, limit = 50): EnergyMeasurement[] {
    if (!this.households.exists(householdId)) throw new NotFoundError("Household");
    return this.measurements.findByHousehold(householdId, limit);
  }
}
