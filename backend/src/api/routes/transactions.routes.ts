import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import type { LedgerTransaction } from "../../domain/types.js";

export function transactionsRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      const asset = req.query.asset ? String(req.query.asset) : "TEC";

      // For Phase 0, only TEC transactions are available (no certificates yet)
      let data: LedgerTransaction[] = [];
      if (asset === "TEC" || asset === "ALL") {
        data = c.tokens.getAllHistory();
      }

      res.json({ success: true, data: data.slice(0, limit) });
    })
  );

  return router;
}
