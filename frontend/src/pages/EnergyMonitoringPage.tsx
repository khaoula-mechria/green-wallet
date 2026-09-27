import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import type { EnergyMeasurement } from "../types";

export function EnergyMonitoringPage() {
  const { household, refresh } = useAuth();
  const { data, loading, reload } = usePolling(
    () => api.get<EnergyMeasurement[]>(`/households/${household!.id}/history?limit=40`),
    4000,
    [household?.id]
  );

  const [production, setProduction] = useState("");
  const [consumption, setConsumption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const chartData = (data ?? [])
    .slice()
    .reverse()
    .map((m) => ({
      time: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      production: m.production,
      consumption: m.consumption,
      surplus: m.surplus,
    }));

  async function submitMeasurement(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post("/energy/measurements", { production: Number(production), consumption: Number(consumption) });
      setSuccess("Measurement recorded.");
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
          <h1>Energy Monitoring</h1>
          <p>
            Physical energy layer: meter readings for <strong>{household?.name}</strong>. The simulation submits
            readings automatically — you can also submit one manually below.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Production &amp; consumption history</div>
          {loading && !data ? (
            <div className="empty-state">Loading…</div>
          ) : chartData.length === 0 ? (
            <div className="empty-state">No measurements yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="production" stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="consumption" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="section-title">Submit a meter reading</div>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <form onSubmit={submitMeasurement}>
            <div className="field">
              <label className="label">Production (kWh)</label>
              <input className="input" type="number" min="0" step="0.1" value={production} onChange={(e) => setProduction(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label">Consumption (kWh)</label>
              <input className="input" type="number" min="0" step="0.1" value={consumption} onChange={(e) => setConsumption(e.target.value)} required />
            </div>
            <button className="btn btn-primary" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Submitting…" : "Submit measurement"}
            </button>
          </form>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 12 }}>
            A positive surplus (production &gt; consumption) is automatically tokenized into TEC at a 1:1 ratio.
          </p>
        </div>
      </div>
    </div>
  );
}
