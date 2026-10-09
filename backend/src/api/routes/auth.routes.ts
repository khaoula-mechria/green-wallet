import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { parseBody } from "../../middleware/validate.js";
import { env } from "../../config/env.js";
import { timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { ForbiddenError, UnauthorizedError } from "../../utils/errors.js";

export const HOUSEHOLD_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// Only identity/profile fields are client-controlled. Balances in particular
// are never accepted from the client: the starting TEC grant is server policy.
export const registerSchema = z
  .object({
    id: z.string().regex(HOUSEHOLD_ID_PATTERN, "must be 1-64 chars: letters, digits, '-' or '_', starting with a letter or digit").optional(),
    name: z.string().trim().min(1).max(100),
    type: z.enum(["producer", "consumer", "prosumer"]),
    location: z.string().trim().max(120).optional(),
    // bcrypt only uses the first 72 bytes of a password.
    password: z.string().min(6).max(72),
    energyType: z.enum(["solar", "wind", "grid"]).optional(),
    batteryCapacityKwh: z.number().finite().min(0).optional(),
  })
  .strict();

const operatorLoginSchema = z.object({ password: z.string().min(1).max(128) }).strict();

/** The operator's identity: starts with "@", which no household id can (HOUSEHOLD_ID_PATTERN). */
export const OPERATOR_SUBJECT = "@operator";

const loginSchema = z
  .object({
    id: z.string().min(1).max(64),
    password: z.string().min(1).max(72),
  })
  .strict();

export function authRoutes(c: Container): Router {
  const router = Router();

  router.post(
    "/register",
    asyncRoute(async (req, res) => {
      const input = parseBody(registerSchema, req.body);
      const result = await c.auth.register({
        ...input,
        location: input.location || "Unknown",
      });
      res.status(201).json({ success: true, data: result });
    })
  );

  // The operator console (technical views: ledger, blocks, certificates, order book).
  router.post(
    "/operator-login",
    asyncRoute(async (req, res) => {
      const { password } = parseBody(operatorLoginSchema, req.body);
      if (!env.operatorPassword) throw new ForbiddenError("the operator console is closed on this deployment");
      const a = Buffer.from(password);
      const b = Buffer.from(env.operatorPassword);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError("invalid credentials");
      const token = jwt.sign({ householdId: OPERATOR_SUBJECT, type: "operator", role: "operator" }, env.jwtSecret, {
        expiresIn: env.jwtExpiresIn,
      } as jwt.SignOptions);
      res.json({ success: true, data: { token } });
    })
  );

  router.post(
    "/login",
    asyncRoute(async (req, res) => {
      const { id, password } = parseBody(loginSchema, req.body);
      const result = await c.auth.login(id, password);
      res.json({ success: true, data: result });
    })
  );

  return router;
}
