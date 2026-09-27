import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { MeasurementRepository } from "../db/repositories/measurementRepository.js";
import type { EnergyMeasurement, TokenTransaction } from "../domain/types.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import type { TokenService } from "./tokenService.js";

export interface RecordMeasurementResult {
  measurement: EnergyMeasurement;
  mintTx: TokenTransaction | null;
}

/**
 * Physical-energy-layer entry point: records what a household's meter
 * reported (production/consumption in kWh) and derives surplus/deficit.
 * A positive surplus is immediately tokenized (surplus kWh -> TEC) via
 * TokenService — this is the "surplus calculation -> blockchain/token
 * system" step of the pipeline described in the spec.
 */
export class MeasurementService {
  private readonly households: HouseholdRepository;
  private readonly measurements: MeasurementRepository;

  constructor(db: Database, private readonly tokenService: TokenService) {
    this.households = new HouseholdRepository(db);
    this.measurements = new MeasurementRepository(db);
  }

  async record(
    householdId: string,
    production: number,
    consumption: number,
    timestamp: number = Date.now()
  ): Promise<RecordMeasurementResult> {
    if (production < 0 || consumption < 0) throw new ValidationError("production/consumption must be >= 0");
    const household = this.households.findById(householdId);
    if (!household) throw new NotFoundError("Household");

    const surplus = Number((production - consumption).toFixed(4));

    const measurement: EnergyMeasurement = {
      id: uuid(),
      householdId,
      timestamp,
      production,
      consumption,
      surplus,
    };

    this.measurements.insert(measurement);
    this.households.updateSnapshot(householdId, production, consumption, timestamp);

    let mintTx: TokenTransaction | null = null;
    if (surplus > 0) {
      mintTx = await this.tokenService.mint(householdId, surplus);
    }

    return { measurement, mintTx };
  }

  getRecent(limit = 100): EnergyMeasurement[] {
    return this.measurements.findAll(limit);
  }

  getForHousehold(householdId: string, limit = 50): EnergyMeasurement[] {
    if (!this.households.findById(householdId)) throw new NotFoundError("Household");
    return this.measurements.findByHousehold(householdId, limit);
  }
}
