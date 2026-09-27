import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { TypeBadge } from "../components/Badge";
import type { MicrogridNode } from "../types";

export function MicrogridPage() {
  const { data, loading } = usePolling(() => api.get<MicrogridNode[]>("/microgrid"), 4000);

  const producers = (data ?? []).filter((n) => n.type !== "consumer");
  const consumers = (data ?? []).filter((n) => n.type === "consumer");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Microgrid</h1>
          <p>
            Conceptual view of the local microgrid — a software simulation, not control of a real electrical grid.
          </p>
        </div>
      </div>

      {loading && !data ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 1fr", gap: 16, alignItems: "start" }}>
            <div>
              <div className="section-title">Producers</div>
              {producers.map((n) => (
                <NodeCard key={n.id} node={n} />
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", paddingTop: 40 }}>
              <div className="flow-node" style={{ background: "var(--color-primary-soft)", borderColor: "var(--color-primary)" }}>
                <strong>Microgrid</strong>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                  {producers.length} producers ↔ {consumers.length} consumers
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

      <div className="card">
        <div className="section-title">Households by location</div>
        <table>
          <thead>
            <tr>
              <th>Household</th>
              <th>Type</th>
              <th>Location</th>
              <th>Net flow (kWh)</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((n) => (
              <tr key={n.id}>
                <td>{n.name}</td>
                <td>
                  <TypeBadge type={n.type} />
                </td>
                <td>{n.location}</td>
                <td style={{ color: n.netFlow >= 0 ? "var(--color-primary-dark)" : "var(--color-danger)", fontWeight: 600 }}>
                  {n.netFlow >= 0 ? "+" : ""}
                  {n.netFlow.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: MicrogridNode }) {
  const positive = node.netFlow >= 0;
  return (
    <div className="card" style={{ marginBottom: 8, boxShadow: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{node.name}</strong>
        <TypeBadge type={node.type} />
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>{node.location}</div>
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: positive ? "var(--color-primary-dark)" : "var(--color-danger)" }}>
        {positive ? "+" : ""}
        {node.netFlow.toFixed(2)} kWh
      </div>
    </div>
  );
}
