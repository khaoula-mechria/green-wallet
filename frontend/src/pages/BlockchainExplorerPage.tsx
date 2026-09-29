import { useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { StatCard } from "../components/StatCard";
import { AssetBadge, TxTypeBadge } from "../components/Badge";
import { fmtSimTime } from "../format";
import type { BlockDetail, BlockchainBlock, LedgerStatus } from "../types";

export function BlockchainExplorerPage() {
  const { data: status } = usePolling(() => api.get<LedgerStatus>("/blockchain/status"), 2500);
  const { data: blocks, loading } = usePolling(() => api.get<BlockchainBlock[]>("/blockchain/blocks?limit=100"), 2500);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const { data: blockDetail } = usePolling(
    () => (selectedIndex === null ? Promise.resolve(null) : api.get<BlockDetail>(`/blockchain/blocks/${selectedIndex}`)),
    5000,
    [selectedIndex]
  );

  const reversedBlocks = (blocks ?? []).slice().reverse();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Blockchain Explorer</h1>
          <p>
            Hash-chained record of every TEC payment, green certificate and auction result. Hedera-style IDs, simulated
            network — every fee is paid by the operator.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Ledger" value={status?.mode === "hedera" ? "Hedera testnet" : "Simulated Hedera"} sub={status?.network} />
        <StatCard label="Operator (fee payer)" value={status?.operatorAccountId ?? "—"} sub={`fees paid: ${(status?.totalFeesHbar ?? 0).toFixed(4)} ℏ`} />
        <StatCard
          label="Token IDs"
          value={status?.tokenIds.TEC ?? "—"}
          sub={status ? `TEC · SOLAR ${status.tokenIds.SOLAR} · WIND ${status.tokenIds.WIND}` : undefined}
        />
        <StatCard label="Blocks" value={String(status?.blocksCount ?? "—")} sub={`${status?.transactionsCount ?? 0} transactions kept`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Blocks (one per market interval)</div>
          {loading && !blocks ? (
            <div className="empty-state">Loading…</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Hash</th>
                    <th>Txs</th>
                    <th>Interval</th>
                  </tr>
                </thead>
                <tbody>
                  {reversedBlocks.map((b) => (
                    <tr
                      key={b.index}
                      onClick={() => setSelectedIndex(b.index)}
                      style={{ cursor: "pointer" }}
                      className={selectedIndex === b.index ? "row-highlight" : undefined}
                    >
                      <td>{b.index}</td>
                      <td className="mono">{b.hash.slice(0, 16)}…</td>
                      <td>{b.transactionIds.length}</td>
                      <td className="muted">{fmtSimTime(b.simTime)}</td>
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
              <DetailRow label="Simulated time" value={fmtSimTime(blockDetail.simTime)} />
              <div style={{ marginTop: 12 }} className="table-scroll">
                <div className="label" style={{ marginBottom: 8 }}>
                  Transactions ({blockDetail.transactions.length})
                </div>
                {blockDetail.transactions.map((tx) => (
                  <div key={tx.id} className="card" style={{ marginBottom: 8, boxShadow: "none", padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <TxTypeBadge type={tx.type} asset={tx.asset} />
                      <AssetBadge asset={tx.asset} />
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 6 }}>
                      {tx.fromLabel} → {tx.toLabel}: <strong>{tx.amount.toFixed(tx.asset === "TEC" ? 2 : 3)}</strong>
                      {tx.asset === "TEC" ? " TEC" : " kWh"}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {tx.memo}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--color-blue)", marginTop: 4 }}>
                      {tx.id} · fee {tx.feeHbar} ℏ (operator)
                    </div>
                  </div>
                ))}
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
