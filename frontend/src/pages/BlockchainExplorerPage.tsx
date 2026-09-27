import { useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { StatCard } from "../components/StatCard";
import type { BlockchainBlock, BlockchainTransaction } from "../types";

interface Status {
  mode: "local" | "hedera";
  blocksCount: number;
  details: Record<string, unknown>;
}

export function BlockchainExplorerPage() {
  const { data: status } = usePolling(() => api.get<Status>("/blockchain/status"), 5000);
  const { data: blocks, loading } = usePolling(() => api.get<BlockchainBlock[]>("/blockchain/blocks"), 5000);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const { data: blockDetail } = usePolling(
    () =>
      selectedIndex === null
        ? Promise.resolve(null)
        : api.get<BlockchainBlock & { transactions: BlockchainTransaction[] }>(`/blockchain/blocks/${selectedIndex}`),
    6000,
    [selectedIndex]
  );

  const reversedBlocks = (blocks ?? []).slice().reverse();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Blockchain Explorer</h1>
          <p>Immutable, hash-chained record of every token mint, transfer and trade settlement.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Ledger mode" value={status?.mode === "hedera" ? "Hedera testnet" : "Local (simulated)"} />
        <StatCard label="Blocks mined" value={String(status?.blocksCount ?? "—")} />
        <StatCard label="Latest hash" value={String((status?.details.latestHash as string | undefined)?.slice(0, 14) ?? "—") + "…"} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Blocks</div>
          {loading && !blocks ? (
            <div className="empty-state">Loading…</div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Hash</th>
                  <th>Txs</th>
                  <th>Mined</th>
                </tr>
              </thead>
              <tbody>
                {reversedBlocks.map((b) => (
                  <tr key={b.index} onClick={() => setSelectedIndex(b.index)} style={{ cursor: "pointer", background: selectedIndex === b.index ? "var(--color-primary-soft)" : undefined }}>
                    <td>{b.index}</td>
                    <td className="mono">{b.hash.slice(0, 16)}…</td>
                    <td>{b.transactionIds.length}</td>
                    <td>{new Date(b.timestamp).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-title">Block detail</div>
          {!blockDetail ? (
            <div className="empty-state">Select a block to inspect its transactions.</div>
          ) : (
            <div>
              <DetailRow label="Index" value={String(blockDetail.index)} />
              <DetailRow label="Hash" value={blockDetail.hash} mono />
              <DetailRow label="Previous hash" value={blockDetail.previousHash} mono />
              <DetailRow label="Nonce" value={String(blockDetail.nonce)} />
              <DetailRow label="Mined at" value={new Date(blockDetail.timestamp).toLocaleString()} />
              <div style={{ marginTop: 12 }}>
                <div className="label" style={{ marginBottom: 8 }}>
                  Transactions
                </div>
                {blockDetail.transactions.length === 0 ? (
                  <div className="empty-state">Genesis block — no transactions.</div>
                ) : (
                  blockDetail.transactions.map((tx) => (
                    <div key={tx.id} className="card" style={{ marginBottom: 8, boxShadow: "none" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{tx.type}</div>
                      <div className="mono" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                        {(tx.fromId ?? "treasury")} → {tx.toId}
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>{tx.amount.toFixed(2)} TEC</div>
                      {tx.hederaTransactionId && (
                        <div className="mono" style={{ fontSize: 11, color: "var(--color-blue)", marginTop: 4 }}>
                          Hedera: {tx.hederaTransactionId}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span className={mono ? "mono" : ""} style={{ maxWidth: "65%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}
