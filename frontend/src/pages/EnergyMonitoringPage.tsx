import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { fmtClock, fmtPrice, fmtSimTime } from "../format";
import type { EnergyMeasurement, MeasurementResult } from "../types";
import { AXIS_TICK, CHART_MARGIN, COLORS, ChartFrame, ChartTooltip, KV, Key, Legend, PageHead, Section, niceTicks } from "../components/ui";

export function EnergyMonitoringPage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(
    () => api.get<EnergyMeasurement[]>(`/households/${household!.id}/history?limit=48`),
    2500,
    [household?.id]
  );

  const [production, setProduction] = useState("");
  const [consumption, setConsumption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isConsumer = household?.type === "consumer";

  const chartData = (data ?? [])
    .slice()
    .reverse()
    .map((m) => ({ time: fmtClock(m.simTime), production: m.production, consumption: m.consumption }));
  const yTicks = niceTicks(Math.max(0.5, ...chartData.map((d) => Math.max(isConsumer ? 0 : d.production, d.consumption))));

  async function submitMeasurement(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const result = await api.post<MeasurementResult>("/energy/measurements", {
        production: isConsumer ? 0 : Number(production),
        consumption: Number(consumption),
      });
      const f = result.measurement.flow;
      const immediate = [
        f.selfUse > 0 && `${f.selfUse.toFixed(2)} kWh self-used`,
        f.toBattery > 0 && `${f.toBattery.toFixed(2)} kWh into your battery`,
        f.toStorage > 0 && `${f.toStorage.toFixed(2)} kWh into rented storage`,
        f.fromBattery > 0 && `${f.fromBattery.toFixed(2)} kWh from your battery`,
        f.fromStorage > 0 && `${f.fromStorage.toFixed(2)} kWh from your storage`,
      ].filter(Boolean);
      const pending = f.toAuction > 0 ? `${f.toAuction.toFixed(2)} kWh to sell` : f.toBuy > 0 ? `${f.toBuy.toFixed(2)} kWh to buy` : null;
      setSuccess(
        `Reading recorded. ${immediate.length ? `Done now: ${immediate.join(", ")}. ` : ""}${
          pending ? `${pending} settles in the auction in ${Math.ceil(result.settlesInMs / 1000)} s.` : ""
        }`
      );
      setProduction("");
      setConsumption("");
      await reload();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit measurement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHead
        kicker="08 · My home"
        title={
          <>
            The <em>meter</em>
          </>
        }
        lede={
          <>
            Readings for <b>{household?.name}</b>, and where every kWh went. Your own battery and stored energy are used at once; whatever is left waits for
            the auction at the end of the half hour.
          </>
        }
      />

      <Section num="8.1" title="Production and use" note="kWh per half hour, the latest 24 hours.">
        {loading && !data ? (
          <div className="empty-state">Reading the meter…</div>
        ) : chartData.length === 0 ? (
          <div className="empty-state">No readings yet.</div>
        ) : (
          <figure className="figure">
            <Legend>
              {!isConsumer && (
                <Key kind="line" color={COLORS.supply}>
                  Production
                </Key>
              )}
              <Key kind="line" color={COLORS.demand}>
                Consumption
              </Key>
            </Legend>
            <ChartFrame y="kWh per half hour" x="time of day (simulated)">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={CHART_MARGIN}>
                <CartesianGrid stroke={COLORS.ruleSoft} />
                <XAxis dataKey="time" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.rule }} minTickGap={32} />
                <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]]} />
                <Tooltip
                  cursor={{ stroke: COLORS.ink, strokeWidth: 1 }}
                  content={({ active, payload, label }) => (
                    <ChartTooltip
                      active={active}
                      title={label}
                      rows={(payload ?? []).map((p) => ({
                        label: p.dataKey === "production" ? "Produced" : "Used",
                        value: `${Number(p.value).toFixed(2)} kWh`,
                        color: p.dataKey === "production" ? COLORS.supply : COLORS.demand,
                      }))}
                    />
                  )}
                />
                {!isConsumer && (
                  <Area type="monotone" dataKey="production" stroke={COLORS.supply} strokeWidth={2} fill={COLORS.supply} fillOpacity={0.1} isAnimationActive={false} />
                )}
                <Area type="monotone" dataKey="consumption" stroke={COLORS.demand} strokeWidth={2} fill={COLORS.demand} fillOpacity={0.1} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            </ChartFrame>
          </figure>
        )}
      </Section>

      <Section num="8.2" title="Submit a reading" note="Manual readings are capped and rate-limited, because production earns certificates.">
        <div className="columns">
          <form onSubmit={submitMeasurement}>
            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
            <div className="form-row">
              {!isConsumer && (
                <div className="field">
                  <label className="label">Produced, kWh</label>
                  <input className="input" type="number" min="0" step="0.1" value={production} onChange={(e) => setProduction(e.target.value)} required />
                </div>
              )}
              <div className="field">
                <label className="label">Used, kWh</label>
                <input className="input" type="number" min="0" step="0.1" value={consumption} onChange={(e) => setConsumption(e.target.value)} required />
              </div>
            </div>
            <button className="btn btn-primary" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit reading"}
            </button>
          </form>
          <KV
            rows={[
              ["Production", "earns certificates, never TEC"],
              ["Surplus", "battery → storage → auction → export"],
              ["Deficit", "battery → storage → auction → import"],
            ]}
          />
        </div>
      </Section>

      <Section num="8.3" title="Where each kWh went" note="All energy figures are rates in kWh/30 min (one row = one half hour). Own sources settle at once; the auction columns fill in when the half hour closes.">
        {!data || data.length === 0 ? (
          <div className="empty-state">No readings yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="num">Made</th>
                  <th className="num">Used</th>
                  <th className="num">Self-use</th>
                  <th className="num">Battery ±</th>
                  <th className="num">Storage ±</th>
                  <th>Auction</th>
                  <th>Utility</th>
                  <th className="num">Price · TEC/kWh</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => {
                  const f = m.flow;
                  const battery = f.toBattery - f.fromBattery;
                  const storage = f.toStorage - f.fromStorage;
                  return (
                    <tr key={m.id}>
                      <td className="mono">
                        {fmtSimTime(m.simTime)}
                        {m.source === "manual" && (
                          <span className="tag tag-pending" style={{ marginLeft: 8 }}>
                            manual
                          </span>
                        )}
                      </td>
                      <td className="num">{m.production.toFixed(2)}</td>
                      <td className="num">{m.consumption.toFixed(2)}</td>
                      <td className="num">{f.selfUse.toFixed(2)}</td>
                      <td className={"num " + (battery > 0 ? "supply" : battery < 0 ? "demand" : "muted")}>{signed(battery)}</td>
                      <td className={"num " + (storage > 0 ? "supply" : storage < 0 ? "demand" : "muted")}>{signed(storage)}</td>
                      <td>
                        {!f.settled ? (
                          <span className="muted">{f.toAuction > 0 ? `selling ${f.toAuction.toFixed(2)}…` : f.toBuy > 0 ? `buying ${f.toBuy.toFixed(2)}…` : "—"}</span>
                        ) : f.sold > 0 ? (
                          <span className="supply">sold {f.sold.toFixed(2)}</span>
                        ) : f.bought > 0 ? (
                          <span className="demand">bought {f.bought.toFixed(2)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {f.exported > 0 ? (
                          <span className="supply">export {f.exported.toFixed(2)}</span>
                        ) : f.imported > 0 ? (
                          <span className="demand">import {f.imported.toFixed(2)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">{f.settled ? fmtPrice(f.price) : <span className="muted">pending</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function signed(n: number): string {
  if (Math.abs(n) < 0.0005) return "—";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}
