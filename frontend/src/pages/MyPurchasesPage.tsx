import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { fmtSimTime, shortId } from "../format";
import type { EnergyTrade } from "../types";

export function MyPurchasesPage() {
  const { household } = useAuth();
  const { data, loading } = usePolling(() => api.get<EnergyTrade[]>(`/trades?householdId=${household!.id}`), 2500, [household?.id]);

  const purchases = (data ?? []).filter((t) => t.buyerId === household?.id);
  const sales = (data ?? []).filter((t) => t.sellerId === household?.id);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>My Trades</h1>
          <p>Marketplace contracts you took part in. Auction trades appear in your Wallet history.</p>
        </div>
      </div>

      <TradeTable title="Purchases" trades={purchases} loading={loading && !data} counterpartyLabel="Seller" counterpartyOf={(t) => t.sellerName} />
      <div style={{ marginTop: 16 }}>
        <TradeTable title="Sales" trades={sales} loading={loading && !data} counterpartyLabel="Buyer" counterpartyOf={(t) => t.buyerName} />
      </div>
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
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : trades.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{counterpartyLabel}</th>
              <th>kWh</th>
              <th>Price</th>
              <th>Total (TEC)</th>
              <th>Certificates</th>
              <th>Ledger tx</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{counterpartyOf(t)}</td>
                <td>{t.amountKwh.toFixed(2)}</td>
                <td>{t.pricePerKwh.toFixed(3)}</td>
                <td>{t.totalPrice.toFixed(2)}</td>
                <td className="muted">
                  {t.certificates.solar > 0 && `☀ ${t.certificates.solar.toFixed(2)} `}
                  {t.certificates.wind > 0 && `🌬 ${t.certificates.wind.toFixed(2)}`}
                  {t.certificates.solar + t.certificates.wind === 0 && "grey"}
                </td>
                <td className="mono">{t.ledgerTxId ? shortId(t.ledgerTxId, 22) : "—"}</td>
                <td className="muted">{fmtSimTime(t.simTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
