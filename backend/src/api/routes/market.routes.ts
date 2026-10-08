import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { parseBody, parseLimit } from "../../middleware/validate.js";
import { z } from "zod";

const offerSchema = z.object({ amountKwh: z.number().finite(), pricePerKwh: z.number().finite() }).strict();
const purchaseSchema = z.object({ amountKwh: z.number().finite().positive() }).strict();

export function marketRoutes(c: Container): Router {
  const router = Router();

  // Market clock, price band and last price (public, like the dashboard).
  router.get(
    "/status",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.market.status() });
    })
  );

  // Clearing price of every settled interval, oldest first (the price chart).
  router.get(
    "/price-history",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.auction.history(parseLimit(req.query.limit, 48)) });
    })
  );

  // The last settled auction with every bid and what it matched.
  router.get(
    "/auctions/latest",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.auction.latest() });
    })
  );

  // What the caller's automatic agent is bidding in the current interval.
  router.get(
    "/my-bid",
    requireAuth,
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.auction.myBid(req.auth!.householdId) });
    })
  );

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
      const { amountKwh, pricePerKwh } = parseBody(offerSchema, req.body);
      const offer = c.marketplace.createOffer(req.auth!.householdId, amountKwh, pricePerKwh);
      res.status(201).json({ success: true, data: offer });
    })
  );

  // The caller's own offers, every status. Declared before /offers/:id.
  router.get(
    "/offers/mine",
    requireAuth,
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.marketplace.getOffersBySeller(req.auth!.householdId) });
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
      const { amountKwh } = parseBody(purchaseSchema, req.body);
      const trade = await c.trades.purchase(req.auth!.householdId, req.params.id, amountKwh);
      c.notifications.notify(trade.sellerId, "TRADE_COMPLETED", trade);
      res.status(201).json({ success: true, data: trade });
    })
  );

  return router;
}
