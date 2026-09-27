import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { requireAuth } from "../../middleware/auth.js";

export function transactionsRoutes(c: Container): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      res.json({ success: true, data: c.tokens.getAllHistory().slice(0, limit) });
    })
  );

  return router;
}
