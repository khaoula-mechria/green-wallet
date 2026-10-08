import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { assertSelf, requireAuth } from "../../middleware/auth.js";
import { parseBody, parseLimit } from "../../middleware/validate.js";
import { z } from "zod";

const price = z.number().finite();
const settingsSchema = z
  .object({
    overflowMode: z.enum(["sell", "store"]).optional(),
    minSellPrice: price.optional(),
    maxBuyPrice: price.optional(),
    storeMinPrice: price.optional(),
    batterySell: z
      .object({ enabled: z.boolean().optional(), minPrice: price.optional(), keepPercent: z.number().finite().optional() })
      .strict()
      .optional(),
    auctionOptOut: z.boolean().optional(),
  })
  .strict();

export function householdsRoutes(c: Container): Router {
  const router = Router();

  // The community directory is visible to logged-in households only.
  router.use(requireAuth);

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.households.getAll() });
    })
  );

  // The caller's own market-agent settings (DESIGN.md §4.1). Declared before /:id.
  router.get(
    "/me/settings",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.households.getSettings(req.auth!.householdId) });
    })
  );

  router.post(
    "/me/settings",
    asyncRoute(async (req, res) => {
      const patch = parseBody(settingsSchema, req.body);
      res.json({ success: true, data: c.households.updateSettings(req.auth!.householdId, patch) });
    })
  );

  router.get(
    "/:id",
    asyncRoute(async (req, res) => {
      res.json({ success: true, data: c.households.getById(req.params.id) });
    })
  );

  // Raw meter history is private to the household itself.
  router.get(
    "/:id/history",
    asyncRoute(async (req, res) => {
      assertSelf(req, req.params.id);
      res.json({ success: true, data: c.households.getHistory(req.params.id, parseLimit(req.query.limit, 50)) });
    })
  );

  return router;
}
