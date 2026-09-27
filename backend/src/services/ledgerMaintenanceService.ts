import type { Database } from "better-sqlite3";
import type { AnchorReport, BlockchainService, ChainVerification } from "../blockchain/BlockchainService.js";
import type { TradeService } from "./tradeService.js";

export interface ReconciliationReport {
  ok: boolean;
  /** Households whose balance differs from the sum of their token history. */
  balanceMismatches: { householdId: string; balanceMicro: number; historyMicro: number }[];
  /** Token transactions whose ledger record is missing or disagrees. */
  ledgerMismatches: { tokenTxId: string; reason: string }[];
  supply: { balancesMicro: number; issuedMicro: number };
}

export interface IntegrityReport {
  chain: ChainVerification;
  reconciliation: ReconciliationReport;
}

/**
 * Background upkeep for the ledger, plus the integrity checks operators run
 * (at boot and via `npm run ledger:check`):
 *  - retry anchoring queued ledger entries to the external chain (outbox);
 *  - release offer capacity held by trades stuck in `pending`;
 *  - verify the hash chain and reconcile balances against their history.
 */
export class LedgerMaintenanceService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly blockchain: BlockchainService,
    private readonly trades: TradeService,
    private readonly options: { pendingTradeTimeoutMs: number }
  ) {}

  async runOnce(): Promise<{ anchor: AnchorReport; releasedTrades: number }> {
    const releasedTrades = this.trades.releaseStalePending(this.options.pendingTradeTimeoutMs);
    const anchor = await this.blockchain.anchorPending();
    return { anchor, releasedTrades };
  }

  start(intervalMs: number): void {
    if (this.timer || intervalMs <= 0) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runOnce()
        .then(({ releasedTrades, anchor }) => {
          if (releasedTrades > 0) console.warn(`[ledger] released ${releasedTrades} stale pending trade(s)`);
          if (anchor.failed > 0) console.warn(`[ledger] ${anchor.failed} anchoring attempt(s) failed; will retry`);
        })
        .catch((err) => console.error("[ledger] maintenance run failed:", (err as Error).message))
        .finally(() => (this.running = false));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reconcile(): ReconciliationReport {
    const balanceMismatches = this.db
      .prepare(
        `SELECT h.id AS householdId, h.tokenBalanceMicro AS balanceMicro,
                COALESCE((SELECT SUM(amountMicro) FROM token_transactions WHERE toHouseholdId = h.id), 0)
              - COALESCE((SELECT SUM(amountMicro) FROM token_transactions WHERE fromHouseholdId = h.id), 0) AS historyMicro
         FROM households h
         WHERE balanceMicro != historyMicro`
      )
      .all() as ReconciliationReport["balanceMismatches"];

    const ledgerMismatches = this.db
      .prepare(
        `SELECT t.id AS tokenTxId,
           CASE
             WHEN b.id IS NULL THEN 'ledger record missing'
             WHEN b.amountMicro != t.amountMicro THEN 'amount differs from ledger'
             WHEN b.toId != t.toHouseholdId OR COALESCE(b.fromId, '') != COALESCE(t.fromHouseholdId, '') THEN 'parties differ from ledger'
             WHEN b.blockIndex IS NULL THEN 'ledger record not in a block'
           END AS reason
         FROM token_transactions t
         LEFT JOIN blockchain_transactions b ON b.id = t.blockchainTxId
         WHERE t.blockchainTxId IS NOT NULL AND reason IS NOT NULL`
      )
      .all() as ReconciliationReport["ledgerMismatches"];

    const supply = this.db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(tokenBalanceMicro), 0) FROM households) AS balancesMicro,
                (SELECT COALESCE(SUM(amountMicro), 0) FROM token_transactions WHERE type IN ('GRANT', 'MINT')) AS issuedMicro`
      )
      .get() as ReconciliationReport["supply"];

    return {
      ok: balanceMismatches.length === 0 && ledgerMismatches.length === 0 && supply.balancesMicro === supply.issuedMicro,
      balanceMismatches,
      ledgerMismatches,
      supply,
    };
  }

  checkIntegrity(): IntegrityReport {
    return { chain: this.blockchain.verifyChain(), reconciliation: this.reconcile() };
  }
}
