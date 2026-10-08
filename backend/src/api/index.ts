import { Router } from "express";
import type { Container } from "../container.js";
import { authRoutes } from "./routes/auth.routes.js";
import { householdsRoutes } from "./routes/households.routes.js";
import { energyRoutes } from "./routes/energy.routes.js";
import { marketRoutes } from "./routes/market.routes.js";
import { tradesRoutes } from "./routes/trades.routes.js";
import { tokensRoutes } from "./routes/tokens.routes.js";
import { walletRoutes } from "./routes/wallet.routes.js";
import { transactionsRoutes } from "./routes/transactions.routes.js";
import { blockchainRoutes } from "./routes/blockchain.routes.js";
import { gridRoutes } from "./routes/grid.routes.js";
import { dashboardRoutes, microgridRoutes } from "./routes/dashboard.routes.js";

export function apiRouter(c: Container): Router {
  const router = Router();

  router.use("/auth", authRoutes(c));
  router.use("/households", householdsRoutes(c));
  router.use("/energy", energyRoutes(c));
  router.use("/market", marketRoutes(c));
  router.use("/trades", tradesRoutes(c));
  router.use("/tokens", tokensRoutes(c));
  router.use("/wallet", walletRoutes(c));
  router.use("/transactions", transactionsRoutes(c));
  router.use("/blockchain", blockchainRoutes(c));
  router.use("/grid", gridRoutes(c));
  router.use("/dashboard", dashboardRoutes(c));
  router.use("/microgrid", microgridRoutes(c));

  return router;
}
