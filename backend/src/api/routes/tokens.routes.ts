import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { assertSelf, requireAuth } from "../../middleware/auth.js";
import { parseLimit } from "../../middleware/validate.js";

export function tokensRoutes(c: Container): Router {
  const router = Router();

  router.use(requireAuth);

  router.get(
    "/balance/:householdId",
    asyncRoute(async (req, res) => {
      assertSelf(req, req.params.householdId);
      res.json({ success: true, data: { householdId: req.params.householdId, balance: c.tokens.getBalance(req.params.householdId) } });
    })
  );

  router.get(
    "/history/:householdId",
    asyncRoute(async (req, res) => {
      assertSelf(req, req.params.householdId);
      const history = c.tokens.getHistory(req.params.householdId, parseLimit(req.query.limit, 100));
      res.json({ success: true, data: c.ledger.toLedgerTxs(history) });
    })
  );

  return router;
}
