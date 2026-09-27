import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { ValidationError } from "../../utils/errors.js";

export function marketRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/offers",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.marketplace.getActiveOffers() });
    })
  );

  router.post(
    "/offers",
    requireAuth,
    asyncRoute(async (req, res) => {
      const { amountKwh, pricePerKwh } = req.body ?? {};
      if (typeof amountKwh !== "number" || typeof pricePerKwh !== "number") {
        throw new ValidationError("amountKwh and pricePerKwh must be numbers");
      }
      const offer = c.marketplace.createOffer(req.auth!.householdId, amountKwh, pricePerKwh);
      res.status(201).json({ success: true, data: offer });
    })
  );

  router.get(
    "/offers/:id",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.marketplace.getOffer(req.params.id) });
    })
  );

  router.post(
    "/offers/:id/cancel",
    requireAuth,
    asyncRoute(async (req, res) => {
      const offer = c.marketplace.cancelOffer(req.auth!.householdId, req.params.id);
      res.json({ success: true, data: offer });
    })
  );

  router.post(
    "/offers/:id/purchase",
    requireAuth,
    asyncRoute(async (req, res) => {
      const { amountKwh } = req.body ?? {};
      if (typeof amountKwh !== "number" || amountKwh <= 0) {
        throw new ValidationError("amountKwh must be a positive number");
      }
      const trade = await c.trades.purchase(req.auth!.householdId, req.params.id, amountKwh);
      c.notifications.notify(trade.sellerId, "TRADE_COMPLETED", trade);
      res.status(201).json({ success: true, data: trade });
    })
  );

  return router;
}
