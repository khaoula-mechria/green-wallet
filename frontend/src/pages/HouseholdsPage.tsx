import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { TypeBadge } from "../components/Badge";
import type { Household } from "../types";

export function HouseholdsPage() {
  const { data, loading } = usePolling(() => api.get<Household[]>("/households"), 5000);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Households</h1>
          <p>All registered households and their live energy/token position.</p>
        </div>
      </div>

      <div className="card">
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Household</th>
                <th>Type</th>
                <th>Location</th>
                <th>Production (kWh)</th>
                <th>Consumption (kWh)</th>
                <th>Net</th>
                <th>Sellable balance (kWh)</th>
                <th>TEC balance</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((h) => {
                const net = h.currentProduction - h.currentConsumption;
                return (
                  <tr key={h.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{h.name}</div>
                      <div className="mono" style={{ color: "var(--color-text-muted)" }}>
                        {h.id}
                      </div>
                    </td>
                    <td>
                      <TypeBadge type={h.type} />
                    </td>
                    <td>{h.location}</td>
                    <td>{h.currentProduction.toFixed(2)}</td>
                    <td>{h.currentConsumption.toFixed(2)}</td>
                    <td style={{ color: net >= 0 ? "var(--color-primary-dark)" : "var(--color-danger)", fontWeight: 600 }}>
                      {net >= 0 ? "+" : ""}
                      {net.toFixed(2)}
                    </td>
                    <td>{h.energyBalance.toFixed(2)}</td>
                    <td>{h.tokenBalance.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
