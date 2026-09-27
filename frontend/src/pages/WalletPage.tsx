import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import type { TokenTransaction } from "../types";

export function WalletPage() {
  const { household } = useAuth();
  const { data, loading } = usePolling(
    () => api.get<TokenTransaction[]>(`/tokens/history/${household!.id}`),
    4000,
    [household?.id]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Token Wallet</h1>
          <p>Your TEC (Tunisian Energy Coin) balance and transaction history.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="TEC balance" value={household?.tokenBalance.toFixed(2) ?? "0.00"} />
        <StatCard label="Sellable energy balance" value={`${household?.energyBalance.toFixed(2) ?? "0.00"} kWh`} />
        <StatCard label="Hedera account" value={household?.hederaAccountId ?? "Not provisioned (local mode)"} />
      </div>

      <div className="card">
        <div className="section-title">Token transaction history</div>
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">No token transactions yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
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
                  <td>{tx.type}</td>
                  <td className="mono">{tx.fromHouseholdId ?? "Treasury (mint)"}</td>
                  <td className="mono">{tx.toHouseholdId}</td>
                  <td style={{ color: tx.toHouseholdId === household?.id ? "var(--color-primary-dark)" : "var(--color-danger)", fontWeight: 600 }}>
                    {tx.toHouseholdId === household?.id ? "+" : "-"}
                    {tx.amount.toFixed(2)}
                  </td>
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
