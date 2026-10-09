import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireOperator } from "../../middleware/auth.js";
import { parseBody } from "../../middleware/validate.js";
import { TREASURY_ACCOUNT } from "../../services/ledgerService.js";
import { registerSchema } from "./auth.routes.js";

const creditSchema = z.object({ amount: z.number().finite().positive().max(1000) }).strict();

/** Operator-console actions. Every route requires an operator token. */
export function adminRoutes(c: Container): Router {
  const router = Router();
  router.use(requireOperator);

  // Add a producer, prosumer or consumer: same rules and welcome grant as a self-registration,
  // but the operator does not get logged in as the new household.
  router.post(
    "/households",
    asyncRoute(async (req, res) => {
      const input = parseBody(registerSchema, req.body);
      const { household } = await c.auth.register({ ...input, location: input.location || "Unknown" });
      res.status(201).json({ success: true, data: household });
    })
  );

  // Credit TEC to a household from the treasury (a ledger transfer, so the money supply is unchanged).
  router.post(
    "/households/:id/credit",
    asyncRoute(async (req, res) => {
      const { amount } = parseBody(creditSchema, req.body);
      const account = c.ledger.getHouseholdAccount(req.params.id);
      c.ledger.transfer("OPERATOR_FUNDING", TREASURY_ACCOUNT, account.id, amount, "Credit from the operator");
      res.json({ success: true, data: c.households.getById(req.params.id) });
    })
  );

  return router;
}
