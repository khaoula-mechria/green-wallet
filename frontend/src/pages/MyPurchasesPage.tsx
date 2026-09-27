import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/Badge";
import type { EnergyTrade } from "../types";

export function MyPurchasesPage() {
  const { household } = useAuth();
  const { data, loading } = usePolling(
    () => api.get<EnergyTrade[]>(`/trades?householdId=${household!.id}`),
    4000,
    [household?.id]
  );

  const purchases = (data ?? []).filter((t) => t.buyerId === household?.id);
  const sales = (data ?? []).filter((t) => t.sellerId === household?.id);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>My Purchases</h1>
          <p>Energy you've bought from other households on the marketplace.</p>
        </div>
      </div>

      <TradeTable title="Purchases" trades={purchases} loading={loading} counterpartyLabel="Seller" counterpartyOf={(t) => t.sellerId} />

      {sales.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <TradeTable title="Sales (as seller)" trades={sales} loading={loading} counterpartyLabel="Buyer" counterpartyOf={(t) => t.buyerId} />
        </div>
      )}
    </div>
  );
}

function TradeTable({
  title,
  trades,
  loading,
  counterpartyLabel,
  counterpartyOf,
}: {
  title: string;
  trades: EnergyTrade[];
  loading: boolean;
  counterpartyLabel: string;
  counterpartyOf: (t: EnergyTrade) => string;
}) {
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      {loading && trades.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : trades.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{counterpartyLabel}</th>
              <th>Amount (kWh)</th>
              <th>Total (TEC)</th>
              <th>Status</th>
              <th>Blockchain Tx</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td className="mono">{counterpartyOf(t)}</td>
                <td>{t.amountKwh.toFixed(2)}</td>
                <td>{t.totalPrice.toFixed(2)}</td>
                <td>
                  <StatusBadge status={t.status} />
                </td>
                <td className="mono">{t.blockchainTxId ? t.blockchainTxId.slice(0, 10) + "…" : "—"}</td>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
