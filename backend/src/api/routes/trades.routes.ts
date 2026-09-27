import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { assertSelf, requireAuth } from "../../middleware/auth.js";
import { NotFoundError } from "../../utils/errors.js";

export function tradesRoutes(c: Container): Router {
  const router = Router();

  router.use(requireAuth);

  // Always scoped to the caller: `householdId`, if given, must be their own.
  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const householdId = (req.query.householdId as string | undefined) ?? req.auth!.householdId;
      assertSelf(req, householdId);
      res.json({ success: true, data: c.trades.getForHousehold(householdId) });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (req, res) => {
      const trade = c.trades.getById(req.params.id);
      const me = req.auth!.householdId;
      // 404 rather than 403 so trade ids of other households aren't confirmed.
      if (trade.buyerId !== me && trade.sellerId !== me) throw new NotFoundError("Trade");
      res.json({ success: true, data: trade });
    })
  );

  return router;
}
