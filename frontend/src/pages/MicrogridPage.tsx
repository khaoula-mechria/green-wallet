import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { TypeBadge } from "../components/Badge";
import { Gauge } from "../components/Gauge";
import { SharedBatteryPanel } from "../components/SharedBatteryPanel";
import { fmtPrice } from "../format";
import type { MarketStatus, MicrogridNode, SharedBatteryStatus } from "../types";

export function MicrogridPage() {
  const { data, loading } = usePolling(() => api.get<MicrogridNode[]>("/microgrid"), 2500);
  const { data: grid } = usePolling(() => api.get<SharedBatteryStatus>("/grid/status"), 2500);
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 2500);

  const generators = (data ?? []).filter((n) => n.type !== "consumer");
  const consumers = (data ?? []).filter((n) => n.type === "consumer");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Microgrid</h1>
          <p>Conceptual view — a software simulation, not control of a real electrical grid.</p>
        </div>
      </div>

      {loading && !data ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px 1fr", gap: 16, alignItems: "start" }}>
            <div>
              <div className="section-title">Producers &amp; prosumers</div>
              {generators.map((n) => (
                <NodeCard key={n.id} node={n} />
              ))}
            </div>

            <div>
              <div className="flow-node" style={{ background: "var(--color-primary-soft)", borderColor: "var(--color-primary)", marginBottom: 12 }}>
                <strong>Local market</strong>
                <div style={{ fontSize: 12.5, marginTop: 4 }}>
                  price {fmtPrice(status?.lastPrice)} · avg {fmtPrice(status?.avg24h)} TEC/kWh
                </div>
              </div>
              <div className="card" style={{ boxShadow: "none", marginBottom: 12 }}>
                <div className="section-title">Shared battery</div>
                {grid ? <SharedBatteryPanel status={grid} /> : <div className="empty-state">Loading…</div>}
              </div>
              <div className="flow-node" style={{ background: "var(--color-blue-soft)", borderColor: "var(--color-blue)" }}>
                <strong>Main utility grid</strong>
                <div style={{ fontSize: 12.5, marginTop: 4 }}>
                  buys at {status?.band.floor.toFixed(2)} · sells at {status?.band.ceiling.toFixed(2)}
                </div>
              </div>
            </div>

            <div>
              <div className="section-title">Consumers</div>
              {consumers.map((n) => (
                <NodeCard key={n.id} node={n} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: MicrogridNode }) {
  const positive = node.netFlow >= 0;
  return (
    <div className="card" style={{ marginBottom: 8, boxShadow: "none", padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{node.name}</strong>
        <TypeBadge type={node.type} />
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
        {node.location}
        {node.overflowMode && ` · ${node.overflowMode} mode`}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }} className={positive ? "pos" : "neg"}>
        {positive ? "+" : ""}
        {node.netFlow.toFixed(2)} kWh
      </div>
      {node.type === "prosumer" && (
        <div style={{ marginTop: 6 }}>
          {node.batteryCapacityKwh > 0 ? (
            <>
              <Gauge value={node.batteryChargeKwh} max={node.batteryCapacityKwh} compact />
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                Battery {node.batteryChargeKwh.toFixed(1)} / {node.batteryCapacityKwh} kWh
                {node.storedKwh > 0 && ` · stored ${node.storedKwh.toFixed(2)} kWh`}
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 11.5 }}>
              No battery{node.storedKwh > 0 && ` · stored ${node.storedKwh.toFixed(2)} kWh`}
            </div>
          )}
        </div>
      )}
      {node.type === "consumer" && node.storedKwh > 0 && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          stored {node.storedKwh.toFixed(2)} kWh (bought)
        </div>
      )}
    </div>
  );
}
