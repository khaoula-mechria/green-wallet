import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { Household, HouseholdType, PublicHousehold, AuthTokenPayload } from "../domain/types.js";
import { env } from "../config/env.js";
import { ValidationError, UnauthorizedError, ConflictError } from "../utils/errors.js";
import type { LedgerService } from "./ledgerService.js";

export interface RegisterInput {
  id?: string;
  name: string;
  type: HouseholdType;
  location: string;
  password: string;
  energyType?: string;
}

export function toPublicHousehold(h: Household): PublicHousehold {
  const { passwordHash: _p, hederaPrivateKeyEncrypted: _k, ...rest } = h;
  return rest;
}

export class AuthService {
  private readonly households: HouseholdRepository;

  constructor(db: Database, private readonly ledger: LedgerService) {
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

    const household: Household = {
      id,
      name: input.name,
      type: input.type,
      location: input.location ?? "Unknown",
      passwordHash,
      hederaAccountId: null,
      hederaPrivateKeyEncrypted: null,
      energyType: input.energyType ?? (input.type === "consumer" ? "grid" : "solar"),
      currentProduction: 0,
      currentConsumption: 0,
      energyBalance: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.households.insert(household);

    // Create household account in the ledger.
    const account = this.ledger.createHouseholdAccount(id, input.name);
    household.hederaAccountId = account.id; // Store the simulated Hedera-style ID

    // Issue welcome grant to prosumers and consumers (not producers).
    if (input.type !== "producer" && env.welcomeGrantTec > 0) {
      this.ledger.transfer("WELCOME_GRANT", "0.0.1001", account.id, env.welcomeGrantTec, "Welcome grant");
    }

    const token = this.issueToken(household);
    return { household: toPublicHousehold(household), token };
  }

  async login(id: string, password: string): Promise<{ household: PublicHousehold; token: string }> {
    const household = this.households.findById(id);
    if (!household) throw new UnauthorizedError("invalid credentials");

    const valid = await bcrypt.compare(password, household.passwordHash);
    if (!valid) throw new UnauthorizedError("invalid credentials");

    const token = this.issueToken(household);
    return { household: toPublicHousehold(household), token };
  }

  private issueToken(household: Household): string {
    const payload: AuthTokenPayload = { householdId: household.id, type: household.type };
    return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
  }
}
