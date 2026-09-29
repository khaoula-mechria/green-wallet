import { useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { AssetBadge, TxTypeBadge } from "../components/Badge";
import { fmtSimTime, shortId } from "../format";
import type { LedgerTx } from "../types";

const FILTERS = [
  { value: "ALL", label: "Everything" },
  { value: "TEC", label: "TEC payments" },
  { value: "CERT", label: "Green certificates" },
  { value: "RECORD", label: "Auction records" },
];

export function TransactionsPage() {
  const [asset, setAsset] = useState("TEC");
  const { data, loading } = usePolling(() => api.get<LedgerTx[]>(`/transactions?limit=150&asset=${asset}`), 2500, [asset]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p>Every ledger movement in the microgrid — TEC payments, green certificates and auction records.</p>
        </div>
        <select className="input" style={{ width: 220 }} value={asset} onChange={(e) => setAsset(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">No transactions yet.</div>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 640 }}>
            <table>
              <thead>
                <tr>
                  <th>Tx ID</th>
                  <th>Type</th>
                  <th>Asset</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Amount</th>
                  <th>Memo</th>
                  <th>Block</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.map((tx) => (
                  <tr key={tx.id}>
                    <td className="mono" title={tx.id}>
                      {shortId(tx.id, 20)}
                    </td>
                    <td>
                      <TxTypeBadge type={tx.type} asset={tx.asset} />
                    </td>
                    <td>
                      <AssetBadge asset={tx.asset} />
                    </td>
                    <td>{tx.fromLabel}</td>
                    <td>{tx.toLabel}</td>
                    <td>
                      {tx.amount.toFixed(tx.asset === "TEC" ? 2 : 3)}
                      {tx.asset === "TEC" ? "" : " kWh"}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {tx.memo}
                    </td>
                    <td>{tx.blockIndex ?? <span className="muted">pending</span>}</td>
                    <td className="muted">{fmtSimTime(tx.simTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
