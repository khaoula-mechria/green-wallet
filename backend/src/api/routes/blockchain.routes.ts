import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { NotFoundError } from "../../utils/errors.js";
import { BlockchainRepository } from "../../db/repositories/blockchainRepository.js";

export function blockchainRoutes(c: Container): Router {
  const router = Router();
  const repo = new BlockchainRepository(c.db);

  router.get(
    "/status",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.blockchain.getStatus() });
    })
  );

  router.get(
    "/blocks",
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const chain = c.blockchain.getChain();
      res.json({ success: true, data: chain.slice(-limit) });
    })
  );

  router.get(
    "/blocks/:index",
    asyncRoute(async (req, res) => {
      const block = c.blockchain.getBlock(Number(req.params.index));
      if (!block) throw new NotFoundError("Block");
      const transactions = block.transactionIds.map((id) => repo.findTransactionById(id)).filter(Boolean);
      res.json({ success: true, data: { ...block, transactions } });
    })
  );

  router.get(
    "/transactions",
    asyncRoute(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      res.json({ success: true, data: repo.findAllTransactions(limit) });
    })
  );

  return router;
}
