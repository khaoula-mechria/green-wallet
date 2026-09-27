import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/Badge";
import type { EnergyOffer } from "../types";

export function MyOffersPage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(
    () => api.get<EnergyOffer[]>("/market/offers").then((offers) => offers.filter((o) => o.sellerId === household!.id)),
    4000,
    [household?.id]
  );

  // Active offers already come back from /market/offers; completed/cancelled ones
  // won't (that endpoint only returns active listings), so we also fetch the
  // household's full offer history via trades for a complete picture below.
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
          <p>Offers you've listed on the marketplace.</p>
        </div>
      </div>

      <div className="card">
        {error && <div className="alert alert-error">{error}</div>}
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">You have no active offers. List your surplus from the Marketplace page.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Offered</th>
                <th>Remaining</th>
                <th>Price (TEC/kWh)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>{o.amountKwh.toFixed(2)} kWh</td>
                  <td>{o.amountRemainingKwh.toFixed(2)} kWh</td>
                  <td>{o.pricePerKwh.toFixed(2)}</td>
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
