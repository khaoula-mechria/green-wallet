import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

export function gridRoutes(c: Container): Router {
  const router = Router();

  // The community battery's state (DESIGN.md §6). Public: system-wide aggregates only.
  router.get(
    "/status",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.grid.status() });
    })
  );

  return router;
}
