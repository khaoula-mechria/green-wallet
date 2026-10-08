import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { parseBody } from "../../middleware/validate.js";
import { env } from "../../config/env.js";

export const HOUSEHOLD_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// Only identity/profile fields are client-controlled. Balances in particular
// are never accepted from the client: the starting TEC grant is server policy.
const registerSchema = z
  .object({
    id: z.string().regex(HOUSEHOLD_ID_PATTERN, "must be 1-64 chars: letters, digits, '-' or '_', starting with a letter or digit").optional(),
    name: z.string().trim().min(1).max(100),
    type: z.enum(["producer", "consumer", "prosumer"]),
    location: z.string().trim().max(120).optional(),
    // bcrypt only uses the first 72 bytes of a password.
    password: z.string().min(6).max(72),
    energyType: z.string().trim().min(1).max(30).optional(),
  })
  .strict();

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
