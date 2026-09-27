import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Database } from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { Household, HouseholdType, PublicHousehold, AuthTokenPayload } from "../domain/types.js";
import { env } from "../config/env.js";
import { ValidationError, UnauthorizedError, ConflictError } from "../utils/errors.js";
import type { BlockchainService } from "../blockchain/BlockchainService.js";
import { atomic } from "../db/transaction.js";
import { tecToMicro } from "../domain/units.js";
import type { TokenService } from "./tokenService.js";

export interface RegisterInput {
  id?: string;
  name: string;
  type: HouseholdType;
  location: string;
  password: string;
  energyType?: string;
  /** Trusted callers only (seeding, the register route's server-side grant) —
   * never pass a client-supplied value through. */
  initialTokenBalance?: number;
}

export function toPublicHousehold(h: Household): PublicHousehold {
  const { passwordHash: _p, hederaPrivateKeyEncrypted: _k, ...rest } = h;
  return rest;
}

export class AuthService {
  private readonly households: HouseholdRepository;

  constructor(
    private readonly db: Database,
    private readonly blockchain: BlockchainService,
    private readonly tokens: TokenService
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
    const grantMicro = tecToMicro(input.initialTokenBalance ?? 0, "initialTokenBalance");
    if (grantMicro < 0) throw new ValidationError("initialTokenBalance must be >= 0");

    // The household and its starting grant commit together; the grant is a
    // ledger-recorded GRANT, so every balance is backed by its history.
    atomic(this.db, () => {
      if (this.households.exists(id)) throw new ConflictError(`household '${id}' already exists`);
      this.households.insert({
        id,
        name: input.name,
        type: input.type,
        location: input.location ?? "Unknown",
        passwordHash,
        hederaAccountId: null,
        hederaPrivateKeyEncrypted: null,
        energyType: input.energyType ?? (input.type === "consumer" ? "grid" : "solar"),
        createdAt: now,
        updatedAt: now,
      });
      if (grantMicro > 0) this.tokens.issueInTx("GRANT", id, grantMicro, { reason: "initial-balance" });
    });

    // Best-effort ledger provisioning (only does real work in Hedera mode).
    try {
      const provisioned = await this.blockchain.provisionAccount(id);
      if (provisioned.accountId && provisioned.encryptedPrivateKey) {
        this.households.setHederaAccount(id, provisioned.accountId, provisioned.encryptedPrivateKey);
      }
    } catch (err) {
      // Provisioning failure must not block registration in an MVP; the
      // household simply stays local-only for settlement until retried.
      console.error(`[auth] Hedera provisioning failed for ${id}:`, (err as Error).message);
    }

    const household = this.households.findById(id)!;
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
