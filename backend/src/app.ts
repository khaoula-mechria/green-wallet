import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { Container } from "./container.js";
import { apiRouter } from "./api/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { env } from "./config/env.js";

export function createApp(container: Container) {
  const app = express();

  // `false` (production default) sends no CORS headers: the frontend is served
  // same-origin behind nginx, so no cross-origin access is needed.
  if (env.corsOrigin !== false) app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: "16kb" }));

  // Applies to mutating/sensitive endpoints only, matching the reference
  // architecture's documented gap being closed here.
  const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
  app.use("/api", limiter);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", apiRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
