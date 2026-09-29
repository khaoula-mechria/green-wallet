import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { Gauge } from "../components/Gauge";
import { SharedBatteryPanel } from "../components/SharedBatteryPanel";
import type { HouseholdSettings, MarketStatus, SharedBatteryStatus } from "../types";

export function BatterySettingsPage() {
  const { household, refresh } = useAuth();
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 5000);
  const { data: grid } = usePolling(() => api.get<SharedBatteryStatus>("/grid/status"), 2500);

  const [form, setForm] = useState<HouseholdSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (household && !form) setForm(household.settings);
  }, [household, form]);

  if (!household || !form) return <div className="empty-state">Loading…</div>;

  const isProsumer = household.type === "prosumer";
  const isProducer = household.type === "producer";
  const isConsumer = household.type === "consumer";
  const band = status?.band;

  const set = <K extends keyof HouseholdSettings>(key: K, value: HouseholdSettings[K]) => setForm({ ...form, [key]: value });
  const setBatterySell = (patch: Partial<HouseholdSettings["batterySell"]>) =>
    setForm({ ...form, batterySell: { ...form.batterySell, ...patch } });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const saved = await api.post<HouseholdSettings>("/households/me/settings", form);
      setForm(saved);
      setSuccess("Settings saved. Your automatic agent uses them from the next interval.");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  const priceInput = (value: number, onChange: (v: number) => void) => (
    <input
      className="input"
      type="number"
      step="0.005"
      min={band?.floor}
      max={band?.ceiling}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      required
    />
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Battery &amp; Settings</h1>
          <p>Your storage and the one-time settings your automatic market agent bids with — like a thermostat.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">My energy storage</div>
          {isProsumer ? (
            household.batteryCapacityKwh > 0 ? (
              <>
                <Gauge label="Home battery" value={household.batteryChargeKwh} max={household.batteryCapacityKwh} />
                <p className="hint" style={{ marginTop: -4 }}>
                  Free to use, no losses. It holds the kWh you can use at night or sell.
                </p>
              </>
            ) : (
              <p className="hint">No home battery — every surplus goes straight to your overflow mode.</p>
            )
          ) : (
            <p className="hint">{isProducer ? "Producers have no battery: output is sold in the auction." : "Consumers have no battery."}</p>
          )}
          {!isProducer && (
            <>
              <Gauge label="My rented space in the shared battery" value={household.storedKwh} max={grid?.rented.capPerHouseholdKwh ?? 10} color="var(--color-accent)" />
              <p className="hint" style={{ marginTop: -4 }}>
                Stored energy pays for itself: it shrinks by {((grid?.decayPerHour ?? 0.01) * 100).toFixed(0)}% per simulated hour, and
                the loss goes to the grid pool. Marketplace purchases are delivered here too.
              </p>
            </>
          )}
          <div className="kv-list" style={{ marginTop: 10 }}>
            <div>
              <span>Reserved in my offers</span>
              <strong>{household.reservedInOffersKwh.toFixed(2)} kWh</strong>
            </div>
            <div>
              <span>Can still list on the marketplace</span>
              <strong>{household.listableKwh.toFixed(2)} kWh</strong>
            </div>
            <div>
              <span>Can still receive</span>
              <strong>{household.storageSpaceKwh.toFixed(2)} kWh</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Market agent settings</div>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <form onSubmit={save}>
            {isProsumer && (
              <div className="field">
                <label className="label">When my battery is full (overflow mode)</label>
                <select className="input" value={form.overflowMode} onChange={(e) => set("overflowMode", e.target.value as HouseholdSettings["overflowMode"])}>
                  <option value="sell">Sell — offer the overflow in the auction now</option>
                  <option value="store">Store — keep it in my rented space and sell later</option>
                </select>
              </div>
            )}

            {!isConsumer && (
              <div className="form-row">
                <div className="field">
                  <label className="label">Never sell surplus below (TEC/kWh)</label>
                  {priceInput(form.minSellPrice, (v) => set("minSellPrice", v))}
                </div>
                {isProsumer && form.overflowMode === "store" && (
                  <div className="field">
                    <label className="label">Sell stored energy from (TEC/kWh)</label>
                    {priceInput(form.storeMinPrice, (v) => set("storeMinPrice", v))}
                  </div>
                )}
              </div>
            )}

            {!isProducer && (
              <div className="field">
                <label className="label">Never pay more than (TEC/kWh)</label>
                {priceInput(form.maxBuyPrice, (v) => set("maxBuyPrice", v))}
              </div>
            )}

            {isProsumer && household.batteryCapacityKwh > 0 && (
              <>
                <label className="toggle-row">
                  <input type="checkbox" checked={form.batterySell.enabled} onChange={(e) => setBatterySell({ enabled: e.target.checked })} />
                  Sell from my battery when the price is high
                </label>
                <div className="form-row">
                  <div className="field">
                    <label className="label">…when the price is at least (TEC/kWh)</label>
                    {priceInput(form.batterySell.minPrice, (v) => setBatterySell({ minPrice: v }))}
                  </div>
                  <div className="field">
                    <label className="label">…but always keep (% of battery)</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={form.batterySell.keepPercent}
                      onChange={(e) => setBatterySell({ keepPercent: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </>
            )}

            <label className="toggle-row">
              <input type="checkbox" checked={form.auctionOptOut} onChange={(e) => set("auctionOptOut", e.target.checked)} />
              Opt out of the auction (export surplus at the floor, import deficits at the ceiling)
            </label>

            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
            {band && (
              <p className="hint">
                All prices must stay inside the band {band.floor.toFixed(2)}–{band.ceiling.toFixed(2)} TEC/kWh. Defaults: sell from the
                floor, buy up to the ceiling ("always beat the utility").
              </p>
            )}
          </form>
        </div>
      </div>

      {grid && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">The shared battery</div>
          <SharedBatteryPanel status={grid} />
        </div>
      )}
    </div>
  );
}
