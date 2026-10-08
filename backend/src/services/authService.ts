import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { Household, HouseholdType, PublicHousehold, AuthTokenPayload } from "../domain/types.js";
import { env } from "../config/env.js";
import { ValidationError, UnauthorizedError, ConflictError } from "../utils/errors.js";
import { TREASURY_ACCOUNT, type LedgerService } from "./ledgerService.js";
import { defaultSettings, resolveSettings, type HouseholdService, type SettingsPatch } from "./householdService.js";

/** Energy source by role (DESIGN.md §0.1): producers are solar or wind farms, prosumers
 * have rooftop solar, consumers only draw from the grid. */
function energyTypeFor(type: HouseholdType, requested: string | undefined): string {
  const allowed = type === "producer" ? ["solar", "wind"] : type === "prosumer" ? ["solar"] : ["grid"];
  if (requested === undefined) return allowed[0];
  if (!allowed.includes(requested)) {
    throw new ValidationError(`a ${type}'s energy source must be ${allowed.join(" or ")}`);
  }
  return requested;
}

export interface RegisterInput {
  id?: string;
  name: string;
  type: HouseholdType;
  location: string;
  password: string;
  energyType?: string;
  /** Prosumers only: home battery size (default HOUSEHOLD_DEFAULT_BATTERY_CAPACITY_KWH, 0 = none). */
  batteryCapacityKwh?: number;
  /** Trusted callers only (seeding): starting agent settings. Never from a client. */
  settings?: SettingsPatch;
}

/** DESIGN.md §1.4: only prosumers have a home battery, enforced here, not only in the UI. */
function batteryCapacityFor(type: HouseholdType, requested: number | undefined): number {
  if (type !== "prosumer") {
    if (requested !== undefined && requested > 0) throw new ValidationError("only prosumers have a home battery");
    return 0;
  }
  const capacity = requested ?? env.householdDefaultBatteryCapacityKwh;
  if (!Number.isFinite(capacity) || capacity < 0 || capacity > env.householdMaxBatteryCapacityKwh) {
    throw new ValidationError(`battery capacity must be between 0 and ${env.householdMaxBatteryCapacityKwh} kWh`);
  }
  return capacity;
}

export class AuthService {
  private readonly households: HouseholdRepository;

  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly householdViews: HouseholdService
  ) {
    this.households = new HouseholdRepository(db);
  }

  async register(input: RegisterInput): Promise<{ household: PublicHousehold; token: string }> {
    if (!input.name || input.name.trim().length === 0) throw new ValidationError("name is required");
    if (!["producer", "consumer", "prosumer"].includes(input.type)) {
      throw new ValidationError("type must be producer, consumer or prosumer");
    }
    if (!input.password || input.password.length < 6) {
      throw new ValidationError("password must be at least 6 characters");
    }

    const id = input.id?.trim() || uuid();
    if (this.households.findById(id)) {
      throw new ConflictError(`household '${id}' already exists`);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const now = Date.now();

    const batteryCapacityKwh = batteryCapacityFor(input.type, input.batteryCapacityKwh);
    const household: Household = {
      id,
      name: input.name,
      type: input.type,
      location: input.location ?? "Unknown",
      passwordHash,
      hederaAccountId: null,
      hederaPrivateKeyEncrypted: null,
      energyType: energyTypeFor(input.type, input.energyType),
      currentProduction: 0,
      currentConsumption: 0,
      batteryCapacityKwh,
      batteryKwh: 0,
      storedKwh: 0,
      settings: resolveSettings(defaultSettings(), input.settings ?? {}, input.type, batteryCapacityKwh),
      importedKwh: 0,
      importCost: 0,
      exportedKwh: 0,
      exportCredit: 0,
      consumedKwh: 0,
      consumedSolarKwh: 0,
      consumedWindKwh: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Household row, ledger account and welcome grant succeed or fail together.
    this.db.transaction(() => {
      this.households.insert(household);
      const account = this.ledger.createHouseholdAccount(id, input.name);
      if (input.type !== "producer" && env.welcomeGrantTec > 0) {
        this.ledger.transfer("WELCOME_GRANT", TREASURY_ACCOUNT, account.id, env.welcomeGrantTec, "Welcome grant");
      }
    })();

    const token = this.issueToken(household);
    return { household: this.householdViews.getById(id), token };
  }

  async login(id: string, password: string): Promise<{ household: PublicHousehold; token: string }> {
    const household = this.households.findById(id);
    if (!household) throw new UnauthorizedError("invalid credentials");

    const valid = await bcrypt.compare(password, household.passwordHash);
    if (!valid) throw new UnauthorizedError("invalid credentials");

    const token = this.issueToken(household);
    return { household: this.householdViews.getById(id), token };
  }

  private issueToken(household: Household): string {
    const payload: AuthTokenPayload = { householdId: household.id, type: household.type };
    return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
  }
}
