import { Router } from "express";
import type { Container } from "../../container.js";
import { asyncRoute } from "../../middleware/errorHandler.js";
import { parseLimit } from "../../middleware/validate.js";
import { NotFoundError } from "../../utils/errors.js";
import { LedgerTransactionRepository } from "../../db/repositories/ledgerTransactionRepository.js";
import type { LedgerTransaction } from "../../domain/types.js";

export function blockchainRoutes(c: Container): Router {
  const router = Router();
  const ledgerRepo = new LedgerTransactionRepository(c.db);

  router.get(
    "/status",
    asyncRoute(async (_req, res) => {
      res.json({ success: true, data: c.ledger.getStatus() });
    })
  );

  router.get(
    "/blocks",
    asyncRoute(async (req, res) => {
      const limit = parseLimit(req.query.limit, 100);
      const chain = c.blockchain.getChain().slice(-limit);
      res.json({ success: true, data: chain });
    })
  );

  router.get(
    "/blocks/:index",
    asyncRoute(async (req, res) => {
      const block = c.blockchain.getBlock(Number(req.params.index));
      if (!block) throw new NotFoundError("Block");
      const txs = block.transactionIds
        .map((id) => ledgerRepo.findById(id))
        .filter((t): t is LedgerTransaction => Boolean(t));
      res.json({ success: true, data: { ...block, transactions: c.ledger.toLedgerTxs(txs) } });
    })
  );

  return router;
}
