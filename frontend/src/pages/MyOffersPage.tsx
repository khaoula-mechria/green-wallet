import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/Badge";
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>My Offers</h1>
          <p>
            Listed kWh stay reserved in your battery / storage. An offer shrinks if your own deficit uses that energy or if
            stored energy decays.
          </p>
        </div>
      </div>

      <div className="card">
        {error && <div className="alert alert-error">{error}</div>}
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">You have no offers. List energy you own from the Marketplace page.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Offered</th>
                <th>Remaining</th>
                <th>Price (TEC/kWh)</th>
                <th>Expires</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>{o.amountKwh.toFixed(2)} kWh</td>
                  <td>{o.amountRemainingKwh.toFixed(2)} kWh</td>
                  <td>{o.pricePerKwh.toFixed(3)}</td>
                  <td className="muted">{fmtSimTime(o.expiresAtSimTime)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    {o.status === "active" && (
                      <button className="btn btn-danger" disabled={cancellingId === o.id} onClick={() => cancel(o.id)}>
                        {cancellingId === o.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
