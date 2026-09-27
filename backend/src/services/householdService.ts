import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import { MeasurementRepository } from "../db/repositories/measurementRepository.js";
import { NotFoundError } from "../utils/errors.js";
import type { PublicHousehold } from "../domain/types.js";
import { toPublicHousehold } from "./authService.js";

export class HouseholdService {
  private readonly households: HouseholdRepository;
  private readonly measurements: MeasurementRepository;

  constructor(db: Database) {
    this.households = new HouseholdRepository(db);
    this.measurements = new MeasurementRepository(db);
  }

  getAll(): PublicHousehold[] {
    return this.households.findAll().map(toPublicHousehold);
  }

  getById(id: string): PublicHousehold {
    const h = this.households.findById(id);
    if (!h) throw new NotFoundError("Household");
    return toPublicHousehold(h);
  }

  getHistory(id: string, limit = 50) {
    if (!this.households.findById(id)) throw new NotFoundError("Household");
    return this.measurements.findByHousehold(id, limit);
  }
}
