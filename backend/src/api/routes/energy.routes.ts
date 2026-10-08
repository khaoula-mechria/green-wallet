import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { parseBody } from "../../middleware/validate.js";
import { env } from "../../config/env.js";
import { ForbiddenError, TooManyRequestsError } from "../../utils/errors.js";

const measurementSchema = z
  .object({
    production: z.number().finite().min(0),
    consumption: z.number().finite().min(0),
  })
  .strict();

export function energyRoutes(c: Container): Router {
  const router = Router();

  // A household's meter readings are private: list the caller's own only.
  router.get(
    "/measurements",
    requireAuth,
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      res.json({ success: true, data: c.measurements.getForHousehold(req.auth!.householdId, limit) });
    })
  );

  // One manual reading per household per interval. In-memory store: must move
  // to a shared store (e.g. Redis) once the backend runs as several instances.
  const perHouseholdLimiter = rateLimit({
    windowMs: Math.max(env.measurementMinIntervalMs, 1),
    limit: 1,
    keyGenerator: (req) => req.auth!.householdId,
    skip: () => env.measurementMinIntervalMs === 0,
    // A rejected (4xx/5xx) reading doesn't use up the household's slot.
    skipFailedRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new TooManyRequestsError(`only one manual reading per ${Math.round(env.measurementMinIntervalMs / 1000)}s is allowed`)),
  });

  // Authenticated households submit their own meter readings; this is the
  // manual equivalent of what the simulation does automatically each tick.
  // Self-reported readings are untrusted (production earns green certificates), so this
  // is disabled by default in production until real, signed meter data exists.
  router.post(
    "/measurements",
    requireAuth,
    (_req, _res, next) => {
      if (!env.manualMeasurementsEnabled) {
        throw new ForbiddenError("manual meter readings are disabled on this deployment");
      }
      next();
    },
    perHouseholdLimiter,
    asyncRoute(async (req, res) => {
      const { production, consumption } = parseBody(measurementSchema, req.body);
      const householdId = req.auth!.householdId;
      const result = await c.measurements.record(householdId, production, consumption, "manual");
      res.status(201).json({ success: true, data: result });
    })
  );

  return router;
}
