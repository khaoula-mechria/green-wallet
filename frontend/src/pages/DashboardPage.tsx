import { Fragment, useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { StatCard } from "../components/StatCard";
import { PriceChart } from "../components/PriceChart";
import { SharedBatteryPanel } from "../components/SharedBatteryPanel";
import { fmtPrice, fmtSimTime } from "../format";
import type { ConservationChecks, DashboardSummary, MarketStatus, PricePoint } from "../types";

export function DashboardPage() {
  const { data, loading, reload } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 2500);
  const { data: history } = usePolling(() => api.get<PricePoint[]>("/market/price-history?limit=96"), 2500);

  if (loading && !data) return <div className="empty-state">Loading dashboard…</div>;
  if (!data) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Live view of the microgrid: physical energy, the local market, and the ledger that proves it.</p>
        </div>
      </div>

      <PipelineFlow />

      <div className="stat-grid">
        <StatCard label="Simulated time" value={fmtSimTime(data.simTime)} sub={`interval #${data.interval}`} />
        <StatCard label="Clearing price" value={fmtPrice(data.lastPrice)} sub={`24h avg ${fmtPrice(data.avg24h)} TEC/kWh`} />
        <StatCard label="Production now" value={`${data.production.toFixed(1)} kWh`} sub={`consumption ${data.consumption.toFixed(1)} kWh`} />
        <StatCard
          label="Green share"
          value={`${data.greenShare.percentGreen}%`}
          sub={`${(data.greenShare.solarKwh + data.greenShare.windKwh).toFixed(1)} green / ${data.greenShare.greyKwh.toFixed(1)} grey kWh`}
        />
        <StatCard
          label="Participants"
          value={String(data.counts.producers + data.counts.prosumers + data.counts.consumers)}
          sub={`${data.counts.producers} producers · ${data.counts.prosumers} prosumers · ${data.counts.consumers} consumers`}
        />
        <StatCard label="TEC held by households" value={data.tokenCirculation.toFixed(2)} sub={`treasury ${data.treasuryBalance.toFixed(2)} TEC`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Local price (last 48 h, simulated)</div>
          <PriceChart points={history ?? []} band={data.band} />
        </div>
        <div className="card">
          <div className="section-title">Shared battery</div>
          <SharedBatteryPanel status={data.sharedBattery} />
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="section-title">Recent marketplace trades</div>
          {data.recentTrades.length === 0 ? (
            <div className="empty-state">No marketplace trades yet. Most energy trades automatically in the auction.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Buyer</th>
                  <th>kWh</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTrades.map((t) => (
                  <tr key={t.id}>
                    <td>{t.sellerName}</td>
                    <td>{t.buyerName}</td>
                    <td>{t.amountKwh.toFixed(2)}</td>
                    <td>{t.pricePerKwh.toFixed(3)}</td>
                    <td>{t.totalPrice.toFixed(2)} TEC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="section-title">Conservation checks</div>
          <ChecksPanel checks={data.checks} />
          <SimControls onChange={reload} />
        </div>
      </div>
    </div>
  );
}

function PipelineFlow() {
  const steps = ["Meter reading", "Green certificate", "Own battery", "Shared battery", "Auction", "Main utility grid"];
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

function ChecksPanel({ checks }: { checks: ConservationChecks }) {
  const rows = [
    { label: "Money: all balances = TEC in existence", ok: checks.money.ok, detail: `${checks.money.sumOfBalances.toFixed(2)} / ${checks.money.totalSupply.toFixed(2)}` },
    { label: "Clearing account back to 0", ok: checks.clearing.ok, detail: `${checks.clearing.balance.toFixed(2)} TEC` },
    { label: "Energy: in = out + stored", ok: checks.energy.ok, detail: `${checks.energy.inputs.toFixed(2)} / ${checks.energy.outputs.toFixed(2)} kWh` },
    { label: "Certificates: issued = held + retired + exported", ok: checks.certificates.ok, detail: `${checks.certificates.issued.toFixed(2)} / ${checks.certificates.accounted.toFixed(2)}` },
    { label: "No negative balance", ok: checks.noNegative.ok, detail: "" },
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      {rows.map((r) => (
        <div key={r.label} className="check-row">
          <span>
            <span className={r.ok ? "check-ok" : "check-fail"}>{r.ok ? "✓" : "✗"}</span> {r.label}
          </span>
          <span className="mono muted">{r.detail}</span>
        </div>
      ))}
    </div>
  );
}

function SimControls({ onChange }: { onChange: () => Promise<void> }) {
  const { data: status, reload } = usePolling(() => api.get<MarketStatus>("/market/status"), 2000);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "pause" | "resume" | "step" | "reset") {
    setError(null);
    if (action === "reset" && !confirm("Reset the demo? All simulated data and registered households are lost.")) return;
    try {
      await api.post(`/sim/${action}`);
      await reload();
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  if (!status?.mockMode) return null;
  return (
    <div>
      <div className="label">Demo simulation</div>
      {error && <div className="alert alert-error">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {status.paused ? (
          <button className="btn btn-primary" onClick={() => run("resume")}>
            Resume
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => run("pause")}>
            Pause
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => run("step")}>
          Next interval
        </button>
        <button className="btn btn-danger" onClick={() => run("reset")}>
          Reset demo
        </button>
      </div>
    </div>
  );
}
