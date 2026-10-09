import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { PageHead, Section } from "../components/ui";
import { fmtSimTime } from "../format";
import type { EnergyTrade } from "../types";

export function MyPurchasesPage() {
  const { household } = useAuth();
  const { data, loading } = usePolling(() => api.get<EnergyTrade[]>(`/trades?householdId=${household!.id}`), 2500, [household?.id]);

  const purchases = (data ?? []).filter((t) => t.buyerId === household?.id);
  const sales = (data ?? []).filter((t) => t.sellerId === household?.id);

  return (
    <div>
      <PageHead
        kicker="07 · The market"
        title={
          <>
            My <em>trades</em>
          </>
        }
        lede="Marketplace contracts you took part in, with the green certificates that travelled with the energy. Auction trades are in your wallet's ledger."
      />
      <Section num="7.1" title="Bought">
        <TradeTable trades={purchases} loading={loading && !data} counterpartyLabel="Seller" counterpartyOf={(t) => t.sellerName} />
      </Section>
      <Section num="7.2" title="Sold">
        <TradeTable trades={sales} loading={loading && !data} counterpartyLabel="Buyer" counterpartyOf={(t) => t.buyerName} />
      </Section>
    </div>
  );
}

function TradeTable({
  trades,
  loading,
  counterpartyLabel,
  counterpartyOf,
}: {
  trades: EnergyTrade[];
  loading: boolean;
  counterpartyLabel: string;
  counterpartyOf: (t: EnergyTrade) => string;
}) {
  if (loading) return <div className="empty-state">Reading trades…</div>;
  if (trades.length === 0) return <div className="empty-state">None yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>{counterpartyLabel}</th>
          <th className="num">kWh</th>
          <th className="num">Price · TEC/kWh</th>
          <th className="num">Total · TEC</th>
          <th>Energy type</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id}>
            <td className="cell-name">{counterpartyOf(t)}</td>
            <td className="num">{t.amountKwh.toFixed(2)}</td>
            <td className="num">{t.pricePerKwh.toFixed(3)}</td>
            <td className="num">{t.totalPrice.toFixed(2)}</td>
            <td>
              {t.certificates.solar > 0 && <span className="tag tag-solar">{t.certificates.solar.toFixed(2)} solar ☀️</span>}{" "}
              {t.certificates.wind > 0 && <span className="tag tag-wind">{t.certificates.wind.toFixed(2)} wind 🌬️</span>}
              {t.certificates.solar + t.certificates.wind === 0 && <span className="muted">grey (utility)</span>}
            </td>
            <td className="mono muted">{fmtSimTime(t.simTime)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
