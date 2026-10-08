import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { NotFoundError } from "../../utils/errors.js";
import { LedgerTransactionRepository } from "../../db/repositories/ledgerTransactionRepository.js";

export function blockchainRoutes(c: Container): Router {
  const router = Router();
  const ledgerRepo = new LedgerTransactionRepository(c.db);

  router.get(
    "/status",
    asyncRoute(async (_req, res) => {
      const status = c.ledger.getStatus();
      res.json({ success: true, data: status });
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
      const transactions = block.transactionIds
        .map((id) => ledgerRepo.findById(id))
        .filter(Boolean);
      res.json({ success: true, data: { ...block, transactions } });
    })
  );

  return router;
}
