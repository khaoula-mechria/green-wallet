import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

export function householdsRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.households.getAll() });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.households.getById(req.params.id) });
    })
  );

  router.get(
    "/:id/history",
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      res.json({ success: true, data: c.households.getHistory(req.params.id, limit) });
    })
  );

  return router;
}
