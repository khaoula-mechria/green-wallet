import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

export function tokensRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/balance/:householdId",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: { householdId: req.params.householdId, balance: c.tokens.getBalance(req.params.householdId) } });
    })
  );

  router.get(
    "/history/:householdId",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.tokens.getHistory(req.params.householdId) });
    })
  );

  return router;
}
