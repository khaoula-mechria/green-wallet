import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { parseBody } from "../../middleware/validate.js";
import { ValidationError } from "../../utils/errors.js";

// Upper bounds keep every amount comfortably inside integer-unit range.
const MAX_KWH = 1_000_000;
const MAX_PRICE_TEC_PER_KWH = 1_000_000;

const createOfferSchema = z
  .object({
    amountKwh: z.number().finite().positive().max(MAX_KWH),
    pricePerKwh: z.number().finite().positive().max(MAX_PRICE_TEC_PER_KWH),
  })
  .strict();

const purchaseSchema = z.object({ amountKwh: z.number().finite().positive().max(MAX_KWH) }).strict();

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

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
      const { amountKwh, pricePerKwh } = parseBody(createOfferSchema, req.body);
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

  // Optional `Idempotency-Key` header: retrying a purchase with the same key
  // (e.g. after a timeout) returns the original trade instead of buying twice.
  router.post(
    "/offers/:id/purchase",
    requireAuth,
    asyncRoute(async (req, res) => {
      const { amountKwh } = parseBody(purchaseSchema, req.body);
      const idempotencyKey = req.header("Idempotency-Key");
      if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new ValidationError("Idempotency-Key must be 8-128 characters of [A-Za-z0-9_.:-]");
      }
      const { trade, replayed } = await c.trades.purchase(req.auth!.householdId, req.params.id, amountKwh, idempotencyKey);
      if (replayed) {
        res.setHeader("Idempotent-Replayed", "true");
        res.status(200).json({ success: true, data: trade });
        return;
      }
      c.notifications.notify(trade.sellerId, "TRADE_COMPLETED", trade);
      res.status(201).json({ success: true, data: trade });
    })
  );

  return router;
}
