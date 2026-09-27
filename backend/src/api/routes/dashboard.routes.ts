import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";

export function dashboardRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.analytics.getDashboard() });
    })
  );

  return router;
}

// Per-household production/consumption: logged-in households only. The
// dashboard above stays public because it only exposes system-wide aggregates.
export function microgridRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.analytics.getMicrogridView() });
    })
  );

  return router;
}
