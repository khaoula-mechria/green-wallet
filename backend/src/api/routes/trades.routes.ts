import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

export function tradesRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const householdId = req.query.householdId as string | undefined;
      const data = householdId ? c.trades.getForHousehold(householdId) : c.trades.getAll();
      res.json({ success: true, data });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.trades.getById(req.params.id) });
    })
  );

  return router;
}
