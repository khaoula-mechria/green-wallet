import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

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

export function microgridRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.analytics.getMicrogridView() });
    })
  );

  return router;
}
