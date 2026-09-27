import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { ValidationError } from "../../utils/errors.js";

export function energyRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/measurements",
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      res.json({ success: true, data: c.measurements.getRecent(limit) });
    })
  );

  // Authenticated households submit their own meter readings; this is the
  // manual equivalent of what the simulation does automatically each tick.
  router.post(
    "/measurements",
    requireAuth,
    asyncRoute(async (req, res) => {
      const { production, consumption } = req.body ?? {};
      if (typeof production !== "number" || typeof consumption !== "number") {
        throw new ValidationError("production and consumption must be numbers");
      }
      const householdId = req.auth!.householdId;
      const result = await c.measurements.record(householdId, production, consumption);
      res.status(201).json({ success: true, data: result });
    })
  );

  return router;
}
