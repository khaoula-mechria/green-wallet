import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { parseLimit } from "../../middleware/validate.js";
import type { LedgerHistoryFilter } from "../../services/ledgerService.js";
import { ValidationError } from "../../utils/errors.js";

const FILTERS: LedgerHistoryFilter[] = ["ALL", "TEC", "CERT", "RECORD"];

export function transactionsRoutes(c: Container): Router {
  const router = Router();

  // Public by design (docs/DESIGN.md §11): the ledger is the platform's public notary.
  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const limit = parseLimit(req.query.limit, 200);
      const asset = String(req.query.asset ?? "ALL").toUpperCase() as LedgerHistoryFilter;
      if (!FILTERS.includes(asset)) throw new ValidationError(`asset must be one of ${FILTERS.join(", ")}`);

      res.json({ success: true, data: c.ledger.toLedgerTxs(c.ledger.getAllHistory(limit, asset)) });
    })
  );

  return router;
}
