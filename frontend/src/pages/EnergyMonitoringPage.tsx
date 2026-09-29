import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { fmtClock, fmtPrice, fmtSimTime } from "../format";
import type { EnergyMeasurement, MeasurementResult } from "../types";

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
      <div className="page-header">
        <div>
          <h1>Energy</h1>
          <p>
            Meter readings for <strong>{household?.name}</strong> and where every kWh went. Own sources are used
            immediately; the rest settles in the auction at the end of the interval.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Production &amp; consumption (kWh per 30 min)</div>
          {loading && !data ? (
            <div className="empty-state">Loading…</div>
          ) : chartData.length === 0 ? (
            <div className="empty-state">No readings yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {!isConsumer && <Line type="monotone" dataKey="production" stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />}
                <Line type="monotone" dataKey="consumption" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="section-title">Submit a meter reading</div>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <form onSubmit={submitMeasurement}>
            {!isConsumer && (
              <div className="field">
                <label className="label">Production (kWh)</label>
                <input className="input" type="number" min="0" step="0.1" value={production} onChange={(e) => setProduction(e.target.value)} required />
              </div>
            )}
            <div className="field">
              <label className="label">Consumption (kWh)</label>
              <input className="input" type="number" min="0" step="0.1" value={consumption} onChange={(e) => setConsumption(e.target.value)} required />
            </div>
            <button className="btn btn-primary" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Submitting…" : "Submit reading"}
            </button>
          </form>
          <ol className="steps" style={{ marginTop: 14 }}>
            <li>Production earns green certificates, not TEC.</li>
            <li>Surplus: own battery → rented storage (store mode) → auction → export at the floor.</li>
            <li>Deficit: own battery → own stored energy → auction → import at the ceiling.</li>
          </ol>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Where the energy went</div>
        {!data || data.length === 0 ? (
          <div className="empty-state">No readings yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Prod.</th>
                  <th>Cons.</th>
                  <th>Self-use</th>
                  <th>Battery ±</th>
                  <th>Storage ±</th>
                  <th>Auction sold / bought</th>
                  <th>Export / import</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => {
                  const f = m.flow;
                  const battery = f.toBattery - f.fromBattery;
                  const storage = f.toStorage - f.fromStorage;
                  return (
                    <tr key={m.id}>
                      <td>
                        {fmtSimTime(m.simTime)}
                        {m.source === "manual" && <span className="badge badge-pending" style={{ marginLeft: 6 }}>manual</span>}
                      </td>
                      <td>{m.production.toFixed(2)}</td>
                      <td>{m.consumption.toFixed(2)}</td>
                      <td>{f.selfUse.toFixed(2)}</td>
                      <td className={battery > 0 ? "pos" : battery < 0 ? "neg" : "muted"}>{signed(battery)}</td>
                      <td className={storage > 0 ? "pos" : storage < 0 ? "neg" : "muted"}>{signed(storage)}</td>
                      <td>
                        {!f.settled ? (
                          <span className="muted">{f.toAuction > 0 ? `selling ${f.toAuction.toFixed(2)}…` : f.toBuy > 0 ? `buying ${f.toBuy.toFixed(2)}…` : "—"}</span>
                        ) : f.sold > 0 ? (
                          <span className="pos">sold {f.sold.toFixed(2)}</span>
                        ) : f.bought > 0 ? (
                          <span className="neg">bought {f.bought.toFixed(2)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {f.exported > 0 ? (
                          <span className="pos">export {f.exported.toFixed(2)}</span>
                        ) : f.imported > 0 ? (
                          <span className="neg">import {f.imported.toFixed(2)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{f.settled ? fmtPrice(f.price) : <span className="muted">pending</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function signed(n: number): string {
  if (Math.abs(n) < 0.0005) return "—";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}
