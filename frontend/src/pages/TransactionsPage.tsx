import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import type { TokenTransaction } from "../types";

export function TransactionsPage() {
  const { data, loading } = usePolling(() => api.get<TokenTransaction[]>("/transactions?limit=100"), 4000);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Transaction History</h1>
          <p>Every token transaction across the whole microgrid — mints, transfers, and trade settlements.</p>
        </div>
      </div>

      <div className="card">
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">No transactions yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tx ID</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Amount (TEC)</th>
                <th>Blockchain Tx</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.map((tx) => (
                <tr key={tx.id}>
                  <td className="mono">{tx.id.slice(0, 8)}</td>
                  <td>{tx.type}</td>
                  <td className="mono">{tx.fromHouseholdId ?? "Treasury"}</td>
                  <td className="mono">{tx.toHouseholdId}</td>
                  <td>{tx.amount.toFixed(2)}</td>
                  <td className="mono">{tx.blockchainTxId ? tx.blockchainTxId.slice(0, 10) + "…" : "—"}</td>
                  <td>{new Date(tx.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
