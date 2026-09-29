import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { fmtPrice, fmtSimTime } from "../format";
import type { EnergyOffer, MarketStatus } from "../types";

export function MarketplacePage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(() => api.get<EnergyOffer[]>("/market/offers"), 2500);
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 2500);

  const [amountKwh, setAmountKwh] = useState("");
  const [pricePerKwh, setPricePerKwh] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);
  const [purchaseAmounts, setPurchaseAmounts] = useState<Record<string, string>>({});
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const canSell = household?.type !== "producer";

  async function createOffer(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setCreating(true);
    try {
      await api.post("/market/offers", { amountKwh: Number(amountKwh), pricePerKwh: Number(pricePerKwh) });
      setFormSuccess("Offer listed. The kWh are reserved in your battery / storage until sold, cancelled or expired.");
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
    setPurchaseSuccess(null);
    const amount = Number(purchaseAmounts[offer.id] || offer.amountRemainingKwh);
    if (!amount || amount <= 0) {
      setPurchaseError("Enter a valid amount to purchase.");
      return;
    }
    setPurchasingId(offer.id);
    try {
      await api.post(`/market/offers/${offer.id}/purchase`, { amountKwh: amount });
      setPurchaseSuccess(`Bought ${amount.toFixed(2)} kWh — delivered into your space in the shared battery.`);
      setPurchaseAmounts((p) => ({ ...p, [offer.id]: "" }));
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
          <h1>Marketplace</h1>
          <p>Fixed-price offers between households (bilateral contracts), next to the automatic auction.</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        {canSell ? (
          <div className="card">
            <div className="section-title">List energy you own</div>
            {formError && <div className="alert alert-error">{formError}</div>}
            {formSuccess && <div className="alert alert-success">{formSuccess}</div>}
            <form onSubmit={createOffer} className="form-row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">Amount (kWh)</label>
                <input className="input" type="number" min="0.1" step="0.1" value={amountKwh} onChange={(e) => setAmountKwh(e.target.value)} required />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">Price (TEC / kWh)</label>
                <input
                  className="input"
                  type="number"
                  min={status?.band.floor}
                  max={status?.band.ceiling}
                  step="0.005"
                  value={pricePerKwh}
                  placeholder={status ? status.avg24h.toFixed(3) : ""}
                  onChange={(e) => setPricePerKwh(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary" disabled={creating}>
                {creating ? "Listing…" : "Create offer"}
              </button>
            </form>
            <p className="hint">
              You can list <strong>{household?.listableKwh.toFixed(2)} kWh</strong> (stored energy + battery above your{" "}
              {household?.settings.batterySell.keepPercent}% reserve, minus what is already listed).
              {status && (
                <>
                  {" "}
                  Suggested price: last auction <strong>{fmtPrice(status.lastPrice)}</strong>, 24h average{" "}
                  <strong>{fmtPrice(status.avg24h)}</strong>. Allowed range {status.band.floor.toFixed(2)}–{status.band.ceiling.toFixed(2)}.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="card">
            <div className="section-title">Producers sell through the auction</div>
            <p className="hint">
              Producers have no storage, so their output is sold automatically in the auction every interval. Forward
              contracts on future production are future work.
            </p>
          </div>
        )}
        <div className="card">
          <div className="section-title">How delivery works</div>
          <ul className="steps">
            <li>Bought energy is delivered into <strong>your space in the shared battery</strong>.</li>
            <li>It covers your next deficits and decays 1% per simulated hour, like any stored energy.</li>
            <li>Its green certificates are transferred to you with the kWh.</li>
            <li>
              You can receive at most <strong>{household?.storageSpaceKwh.toFixed(2)} kWh</strong> right now (cap per household
              and community storage space).
            </li>
            <li>Offers expire after 24 simulated hours.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Active offers</div>
        {purchaseError && <div className="alert alert-error">{purchaseError}</div>}
        {purchaseSuccess && <div className="alert alert-success">{purchaseSuccess}</div>}
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
                <th>Expires</th>
                <th>Amount to buy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => {
                const own = o.sellerId === household?.id;
                return (
                  <tr key={o.id}>
                    <td>{o.sellerName}</td>
                    <td>{o.amountRemainingKwh.toFixed(2)}</td>
                    <td>{o.pricePerKwh.toFixed(3)}</td>
                    <td className="muted">{fmtSimTime(o.expiresAtSimTime)}</td>
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
                        disabled={own}
                      />
                    </td>
                    <td>
                      <button className="btn btn-primary" disabled={own || purchasingId === o.id} onClick={() => purchase(o)}>
                        {own ? "Your offer" : purchasingId === o.id ? "Buying…" : "Buy"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
