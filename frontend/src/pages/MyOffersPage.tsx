import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/Badge";
import { PageHead, Section } from "../components/ui";
import { fmtSimTime } from "../format";
import type { EnergyOffer } from "../types";

export function MyOffersPage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(() => api.get<EnergyOffer[]>("/market/offers/mine"), 2500, [household?.id]);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function cancel(offerId: string) {
    setError(null);
    setCancellingId(offerId);
    try {
      await api.post(`/market/offers/${offerId}/cancel`);
      await reload();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel offer");
    } finally {
      setCancellingId(null);
    }
  }

  const active = (data ?? []).filter((o) => o.status === "active");
  const past = (data ?? []).filter((o) => o.status !== "active");

  return (
    <div>
      <PageHead
        kicker="06 · The market"
        title={
          <>
            My <em>offers</em>
          </>
        }
        lede="What you have listed. Listed kWh stay reserved in your battery or storage; an offer shrinks if your own deficit uses that energy, or if stored energy decays."
      />
      {error && <div className="alert alert-error" style={{ marginTop: 20 }}>{error}</div>}

      <Section num="6.1" title="Open" note="Expires after 24 simulated hours.">
        {loading && !data ? (
          <div className="empty-state">Reading your offers…</div>
        ) : active.length === 0 ? (
          <div className="empty-state">Nothing listed. List energy you own from the Marketplace.</div>
        ) : (
          <OfferTable offers={active} cancellingId={cancellingId} onCancel={cancel} />
        )}
      </Section>

      {past.length > 0 && (
        <Section num="6.2" title="Closed" note="Sold, cancelled, emptied or expired.">
          <OfferTable offers={past} cancellingId={cancellingId} onCancel={cancel} />
        </Section>
      )}
    </div>
  );
}

function OfferTable({ offers, cancellingId, onCancel }: { offers: EnergyOffer[]; cancellingId: string | null; onCancel: (id: string) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <th className="num">Offered kWh</th>
          <th className="num">Remaining kWh</th>
          <th className="num">Price</th>
          <th>Expires</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {offers.map((o) => (
          <tr key={o.id}>
            <td className="num">{o.amountKwh.toFixed(2)}</td>
            <td className="num">{o.amountRemainingKwh.toFixed(2)}</td>
            <td className="num">{o.pricePerKwh.toFixed(3)}</td>
            <td className="mono muted">{fmtSimTime(o.expiresAtSimTime)}</td>
            <td>
              <StatusBadge status={o.status} />
            </td>
            <td className="num">
              {o.status === "active" && (
                <button className="btn btn-danger btn-small" disabled={cancellingId === o.id} onClick={() => onCancel(o.id)}>
                  {cancellingId === o.id ? "Cancelling…" : "Cancel"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
