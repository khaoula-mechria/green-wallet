import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { assertSelf, requireAuth } from "../../middleware/auth.js";
import { parseBody } from "../../middleware/validate.js";

const topupSchema = z.object({ amount: z.number().positive().max(10000) }).strict();
const cashoutSchema = z.object({ amount: z.number().positive() }).strict();

export function walletRoutes(c: Container): Router {
  const router = Router();

  router.use(requireAuth);

  router.get(
    "/:householdId",
    asyncRoute(async (req, res) => {
      assertSelf(req, req.params.householdId);
      const wallet = c.tokens.wallet(req.params.householdId);
      res.json({ success: true, data: wallet });
    })
  );

  router.post(
    "/topup",
    asyncRoute(async (req, res) => {
      const { amount } = parseBody(topupSchema, req.body);
      const wallet = c.tokens.topup(req.auth!.householdId, amount);
      res.json({ success: true, data: wallet });
    })
  );

  router.post(
    "/cashout",
    asyncRoute(async (req, res) => {
      const { amount } = parseBody(cashoutSchema, req.body);
      const wallet = c.tokens.cashout(req.auth!.householdId, amount);
      res.json({ success: true, data: wallet });
    })
  );

  return router;
}
