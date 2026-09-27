import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";

export function authRoutes(c: Container): Router {
  const router = Router();

  router.post(
    "/register",
    asyncRoute(async (req, res) => {
      const result = await c.auth.register(req.body);
      res.status(201).json({ success: true, data: result });
    })
  );

  router.post(
    "/login",
    asyncRoute(async (req, res) => {
      const { id, password } = req.body ?? {};
      const result = await c.auth.login(id, password);
      res.json({ success: true, data: result });
    })
  );

  return router;
}
