import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import type { EnergyOffer } from "../types";

export function MarketplacePage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(() => api.get<EnergyOffer[]>("/market/offers"), 4000);

  const [amountKwh, setAmountKwh] = useState("");
  const [pricePerKwh, setPricePerKwh] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseAmounts, setPurchaseAmounts] = useState<Record<string, string>>({});
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const canSell = household?.type !== "consumer";

  async function createOffer(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setCreating(true);
    try {
      await api.post("/market/offers", { amountKwh: Number(amountKwh), pricePerKwh: Number(pricePerKwh) });
      setFormSuccess("Offer listed on the marketplace.");
      setAmountKwh("");
      setPricePerKwh("");
      await reload();
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create offer");
    } finally {
      setCreating(false);
    }
  }

  async function purchase(offer: EnergyOffer) {
    setPurchaseError(null);
    const amount = Number(purchaseAmounts[offer.id] ?? offer.amountRemainingKwh);
    if (!amount || amount <= 0) {
      setPurchaseError("Enter a valid amount to purchase.");
      return;
    }
    setPurchasingId(offer.id);
    try {
      await api.post(`/market/offers/${offer.id}/purchase`, { amountKwh: amount });
      await reload();
      await refresh();
    } catch (err) {
      setPurchaseError(err instanceof ApiError ? err.message : "Purchase failed");
    } finally {
      setPurchasingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Energy Marketplace</h1>
          <p>Browse active surplus offers and buy energy with TEC tokens.</p>
        </div>
      </div>

      {canSell && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">List your surplus for sale</div>
          {formError && <div className="alert alert-error">{formError}</div>}
          {formSuccess && <div className="alert alert-success">{formSuccess}</div>}
          <form onSubmit={createOffer} className="form-row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">Amount (kWh)</label>
              <input className="input" type="number" min="0.1" step="0.1" value={amountKwh} onChange={(e) => setAmountKwh(e.target.value)} required />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">Price (TEC / kWh)</label>
              <input className="input" type="number" min="0.01" step="0.01" value={pricePerKwh} onChange={(e) => setPricePerKwh(e.target.value)} required />
            </div>
            <button className="btn btn-primary" disabled={creating}>
              {creating ? "Listing…" : "Create offer"}
            </button>
          </form>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 10 }}>
            Your available sellable balance: <strong>{household?.energyBalance.toFixed(2)} kWh</strong>
          </p>
        </div>
      )}

      <div className="card">
        <div className="section-title">Active offers</div>
        {purchaseError && <div className="alert alert-error">{purchaseError}</div>}
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">No active offers right now.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Available (kWh)</th>
                <th>Price (TEC/kWh)</th>
                <th>Amount to buy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.sellerId}</td>
                  <td>{o.amountRemainingKwh.toFixed(2)}</td>
                  <td>{o.pricePerKwh.toFixed(2)}</td>
                  <td style={{ width: 120 }}>
                    <input
                      className="input"
                      type="number"
                      min="0.1"
                      max={o.amountRemainingKwh}
                      step="0.1"
                      placeholder={o.amountRemainingKwh.toFixed(2)}
                      value={purchaseAmounts[o.id] ?? ""}
                      onChange={(e) => setPurchaseAmounts((p) => ({ ...p, [o.id]: e.target.value }))}
                      disabled={o.sellerId === household?.id}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-primary"
                      disabled={o.sellerId === household?.id || purchasingId === o.id}
                      onClick={() => purchase(o)}
                    >
                      {o.sellerId === household?.id ? "Your offer" : purchasingId === o.id ? "Buying…" : "Buy"}
                    </button>
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
