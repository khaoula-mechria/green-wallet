import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { fmtPrice, fmtSimTime } from "../format";
import { PageHead, Section } from "../components/ui";
import { Link } from "react-router-dom";
import type { DashboardSummary, EnergyOffer, MarketStatus } from "../types";

export function MarketplacePage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(() => api.get<EnergyOffer[]>("/market/offers"), 2500);
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 2500);
  const { data: summary } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 5000);

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
    const typed = purchaseAmounts[offer.id];
    setPurchasingId(offer.id);
    try {
      // "Buy everything listed": read what is left right now, since neighbours may have just bought part of it.
      let amount = Number(typed);
      if (!typed) {
        const fresh = await api.get<EnergyOffer>(`/market/offers/${offer.id}`);
        if (fresh.status !== "active" || fresh.amountRemainingKwh <= 0) {
          setPurchaseError("This offer has just sold out.");
          await reload();
          return;
        }
        amount = fresh.amountRemainingKwh;
      }
      if (!amount || amount <= 0) {
        setPurchaseError("Enter a valid amount to purchase.");
        return;
      }
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
      <PageHead
        kicker="05 · The market"
        title={
          <>
            Deals <em>between neighbours</em>
          </>
        }
        lede="Fixed-price offers — bilateral contracts that sit beside the automatic auction. The seller names the price, the buyer chooses the seller, and the energy is delivered into the buyer's space in the shared battery."
      />

      <Section
        num="5.1"
        title={canSell ? "List energy you own" : "Producers sell at auction"}
        note={canSell ? "You can only sell what you own now. Listed kWh stay where they are, reserved, until sold, cancelled or expired." : undefined}
      >
        {canSell ? (
          <div className="columns-wide">
            <div>
              {formError && <div className="alert alert-error">{formError}</div>}
              {formSuccess && <div className="alert alert-success">{formSuccess}</div>}
              <form onSubmit={createOffer}>
                <div className="form-row" style={{ alignItems: "flex-end" }}>
                  <div className="field">
                    <label className="label">Amount, kWh</label>
                    <input className="input" type="number" min="0.1" step="0.1" value={amountKwh} onChange={(e) => setAmountKwh(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label className="label">Price, TEC per kWh</label>
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
                  <div className="field" style={{ flex: "0 0 auto" }}>
                    <button className="btn btn-primary" disabled={creating}>
                      {creating ? "Listing…" : "Create offer"}
                    </button>
                  </div>
                </div>
              </form>
              <p className="hint">
                Available to list: <strong>{household?.listableKwh.toFixed(2)} kWh</strong> — stored energy plus battery above your{" "}
                {household?.settings.batterySell.keepPercent}% reserve, less what is already listed.
              </p>
            </div>
            <div>
              <h3 className="sub-head">Pricing it</h3>
              {status && (
                <dl className="kv">
                  <div>
                    <dt>Last auction price</dt>
                    <dd>{fmtPrice(status.lastPrice)}</dd>
                  </div>
                  <div>
                    <dt>24 h average</dt>
                    <dd>{fmtPrice(status.avg24h)}</dd>
                  </div>
                  <div>
                    <dt>Allowed range</dt>
                    <dd>
                      {status.band.floor.toFixed(2)} – {status.band.ceiling.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </div>
        ) : (
          <p className="page-lede">
            A producer has no storage, so its output is sold automatically in the auction every interval. Contracts on future production are future work.
          </p>
        )}
      </Section>

      <Section
        num="5.2"
        title="Open offers"
        note={`Delivered into your rented space: you can receive ${household?.storageSpaceKwh.toFixed(2)} kWh right now. Stored energy decays 1% per simulated hour.`}
      >
        {purchaseError && <div className="alert alert-error">{purchaseError}</div>}
        {purchaseSuccess && <div className="alert alert-success">{purchaseSuccess}</div>}
        {loading && !data ? (
          <div className="empty-state">Reading the offers…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">No offers are open right now.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th className="num">Available kWh</th>
                <th className="num">Price</th>
                <th>Expires</th>
                <th style={{ width: 130 }}>Amount to buy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => {
                const own = o.sellerId === household?.id;
                return (
                  <tr key={o.id}>
                    <td className="cell-name">{o.sellerName}</td>
                    <td className="num">{o.amountRemainingKwh.toFixed(2)}</td>
                    <td className="num">{o.pricePerKwh.toFixed(3)}</td>
                    <td className="mono muted">{fmtSimTime(o.expiresAtSimTime)}</td>
                    <td>
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
                    <td className="num">
                      <button className="btn btn-primary btn-small" disabled={own || purchasingId === o.id} onClick={() => purchase(o)}>
                        {own ? "Yours" : purchasingId === o.id ? "Buying…" : "Buy"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Recent trades" note="Completed marketplace deals across the grid.">
        {!summary || summary.recentTrades.length === 0 ? (
          <div className="empty-state">No marketplace trades yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Buyer</th>
                  <th className="num">kWh</th>
                  <th className="num">Price</th>
                  <th className="num">Total TEC</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentTrades.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/households/${t.sellerId}`}>{t.sellerName}</Link>
                    </td>
                    <td>
                      <Link to={`/households/${t.buyerId}`}>{t.buyerName}</Link>
                    </td>
                    <td className="num">{t.amountKwh.toFixed(2)}</td>
                    <td className="num">{t.pricePerKwh.toFixed(3)}</td>
                    <td className="num">{t.totalPrice.toFixed(2)}</td>
                    <td className="mono muted">{fmtSimTime(t.simTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
