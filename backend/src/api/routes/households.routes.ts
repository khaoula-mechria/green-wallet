import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { assertSelf, requireAuth } from "../../middleware/auth.js";

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
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      res.json({ success: true, data: c.households.getHistory(req.params.id, limit) });
    })
  );

  return router;
}
