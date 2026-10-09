import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { SharedBatteryPanel } from "../components/SharedBatteryPanel";
import { BigBattery, KV, PageHead, Section, SubHead } from "../components/ui";
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
      <PageHead
        kicker="09 · My home"
        title={
          <>
            Battery <em>&amp; agent</em>
          </>
        }
        lede="Your stored energy, and the standing instructions your market agent follows every half hour — set once, like a thermostat."
      />

      <Section num="9.1" title="My storage" note="The home battery is free and lossless. Rented space pays for itself: it shrinks 1% per simulated hour into the grid pool.">
        <div className="columns">
          <div>
            {isProsumer ? (
              household.batteryCapacityKwh > 0 ? (
                <BigBattery warnLow label="🏠 Home battery" value={household.batteryChargeKwh} max={household.batteryCapacityKwh} sub="Free and lossless. Fills first with your surplus." />
              ) : (
                <p className="empty-state">No home battery: every surplus goes straight to your overflow choice.</p>
              )
            ) : (
              <p className="empty-state">{isProducer ? "Producers have no battery: output is sold in the auction." : "Consumers have no battery."}</p>
            )}
            {!isProducer && (
              <BigBattery
                label="🔋 My rented battery (community battery)"
                value={household.storedKwh}
                max={grid?.rented.capPerHouseholdKwh ?? 10}
                sub="Space you rent in the shared neighbourhood battery. Stored energy shrinks 1% per simulated hour: that is the rental fee."
              />
            )}
          </div>
          <KV
            rows={[
              ["Reserved in my offers (level)", `${household.reservedInOffersKwh.toFixed(2)} kWh`],
              ["Can still list for sale (level)", `${household.listableKwh.toFixed(2)} kWh`],
              ["Free space I can still fill (level)", `${household.storageSpaceKwh.toFixed(2)} kWh`],
            ]}
          />
        </div>
      </Section>

      <Section
        num="9.2"
        title="Agent instructions"
        note={band ? `Every price stays inside the utility's band, ${band.floor.toFixed(2)}–${band.ceiling.toFixed(2)} TEC/kWh. Defaults always beat the utility.` : undefined}
      >
        <form onSubmit={save} style={{ maxWidth: 640 }}>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          {isProsumer && (
            <div className="field">
              <label className="label">When my battery is full</label>
              <select className="input" value={form.overflowMode} onChange={(e) => set("overflowMode", e.target.value as HouseholdSettings["overflowMode"])}>
                <option value="sell">Sell — offer the overflow in the auction now</option>
                <option value="store">Store — keep it in my rented space and sell later</option>
              </select>
            </div>
          )}

          {!isConsumer && (
            <div className="form-row">
              <div className="field">
                <label className="label">Never sell surplus below</label>
                {priceInput(form.minSellPrice, (v) => set("minSellPrice", v))}
              </div>
              {isProsumer && form.overflowMode === "store" && (
                <div className="field">
                  <label className="label">Sell stored energy from</label>
                  {priceInput(form.storeMinPrice, (v) => set("storeMinPrice", v))}
                </div>
              )}
            </div>
          )}

          {!isProducer && (
            <div className="field">
              <label className="label">Never pay more than</label>
              {priceInput(form.maxBuyPrice, (v) => set("maxBuyPrice", v))}
            </div>
          )}

          {isProsumer && household.batteryCapacityKwh > 0 && (
            <>
              <label className="check">
                <input type="checkbox" checked={form.batterySell.enabled} onChange={(e) => setBatterySell({ enabled: e.target.checked })} />
                Sell from my battery when the price is high
              </label>
              <div className="form-row">
                <div className="field">
                  <label className="label">…when the price reaches</label>
                  {priceInput(form.batterySell.minPrice, (v) => setBatterySell({ minPrice: v }))}
                </div>
                <div className="field">
                  <label className="label">…always keeping, % of battery</label>
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

          <label className="check">
            <input type="checkbox" checked={form.auctionOptOut} onChange={(e) => set("auctionOptOut", e.target.checked)} />
            Stay out of the auction — export surplus at the floor, import at the ceiling
          </label>

          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </form>
      </Section>

      {grid && (
        <Section num="9.3" title="The shared battery" note="One community battery: rented slices for households, the rest for the operator's grid pool.">
          <div className="columns">
            <SharedBatteryPanel status={grid} />
            <div>
              <SubHead>How storing pays off</SubHead>
              <p className="hint" style={{ marginTop: 0 }}>
                Storing overnight costs about 11% of the energy. It is worth it when the evening price beats the noon price by more than that — which the
                auction usually provides.
              </p>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
