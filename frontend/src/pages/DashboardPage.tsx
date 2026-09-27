import { Fragment } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/Badge";
import type { DashboardSummary } from "../types";

export function DashboardPage() {
  const { data, loading } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 4000);

  if (loading && !data) return <div className="empty-state">Loading dashboard…</div>;
  if (!data) return null;

  const chartData = [
    { name: "Production", value: data.totalProduction, color: "#16a34a" },
    { name: "Consumption", value: data.totalConsumption, color: "#2563eb" },
    { name: "Surplus", value: data.totalSurplus, color: "#0f7a37" },
    { name: "Deficit", value: data.totalDeficit, color: "#dc2626" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Live snapshot of the microgrid — physical energy layer above, digital trading layer below.</p>
        </div>
      </div>

      <PipelineFlow />

      <div className="stat-grid">
        <StatCard label="Producers" value={String(data.totalProducers)} />
        <StatCard label="Consumers" value={String(data.totalConsumers)} />
        <StatCard label="Prosumers" value={String(data.totalProsumers)} />
        <StatCard label="Active offers" value={String(data.activeOffers)} />
        <StatCard label="Completed trades" value={String(data.completedTrades)} />
        <StatCard label="TEC in circulation" value={data.tokenCirculation.toFixed(2)} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Production vs. consumption (kWh, live)</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="section-title">Blockchain ledger</div>
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <StatCard label="Mode" value={data.blockchain.mode === "hedera" ? "Hedera testnet" : "Local (simulated)"} />
            <StatCard label="Blocks mined" value={String(data.blockchain.blocksCount)} />
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 12 }}>
            Every trade settlement is recorded as an immutable, hash-chained block. See the Blockchain Explorer for
            full detail.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Recent trades</div>
        {data.recentTrades.length === 0 ? (
          <div className="empty-state">No trades yet — visit the Marketplace to create or fill an offer.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Buyer</th>
                <th>Amount (kWh)</th>
                <th>Total (TEC)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTrades.map((t) => (
                <tr key={t.id}>
                  <td>{t.sellerId}</td>
                  <td>{t.buyerId}</td>
                  <td>{t.amountKwh.toFixed(2)}</td>
                  <td>{t.totalPrice.toFixed(2)}</td>
                  <td>
                    <StatusBadge status={t.status} />
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

function PipelineFlow() {
  const steps = ["Producer", "Measurement", "Surplus", "Token / Blockchain", "Marketplace", "Consumer purchase"];
  return (
    <div className="pill-flow">
      {steps.map((s, i) => (
        <Fragment key={s}>
          <div className="flow-node">{s}</div>
          {i < steps.length - 1 && <span className="flow-arrow">→</span>}
        </Fragment>
      ))}
    </div>
  );
}
