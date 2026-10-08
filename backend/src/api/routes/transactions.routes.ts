import { Router } from "express";
import type { Container } from "../../container.js";
import type { LedgerTransaction } from "../../domain/types.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

export function transactionsRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      const asset = req.query.asset ? String(req.query.asset) : "TEC";

      // For Phase 0, only TEC transactions are available (no certificates yet)
      let txs: LedgerTransaction[] = [];
      if (asset === "TEC" || asset === "ALL") {
        txs = c.tokens.getAllHistory();
      }

      // Convert to public form with labels and household IDs
      const data = txs.map(tx => c.ledger.toLedgerTxPublic(tx)).slice(0, limit);

      res.json({ success: true, data });
    })
  );

  return router;
}
