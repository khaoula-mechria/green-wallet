import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { TypeBadge } from "../components/Badge";
import { Gauge } from "../components/Gauge";
import type { Household } from "../types";

const SOURCE_ICON = { solar: "☀ solar", wind: "🌬 wind", grid: "— grid" };

export function HouseholdsPage() {
  const { household: me } = useAuth();
  const { data, loading } = usePolling(() => api.get<Household[]>("/households"), 2500);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Households</h1>
          <p>Every participant: producers (large plants), prosumers (homes that generate) and consumers.</p>
        </div>
      </div>

      <div className="card">
        {loading && !data ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Type</th>
                <th>Source</th>
                <th>Production</th>
                <th>Consumption</th>
                <th>Net</th>
                <th style={{ width: 150 }}>Battery</th>
                <th>Stored</th>
                <th>Mode</th>
                <th>TEC</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((h) => {
                const net = h.currentProduction - h.currentConsumption;
                return (
                  <tr key={h.id} className={h.id === me?.id ? "row-highlight" : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{h.name}</div>
                      <div className="mono muted">
                        {h.id} · {h.accountId}
                      </div>
                    </td>
                    <td>
                      <TypeBadge type={h.type} />
                    </td>
                    <td>{SOURCE_ICON[h.energyType]}</td>
                    <td>{h.currentProduction.toFixed(2)}</td>
                    <td>{h.currentConsumption.toFixed(2)}</td>
                    <td className={net >= 0 ? "pos" : "neg"}>
                      {net >= 0 ? "+" : ""}
                      {net.toFixed(2)}
                    </td>
                    <td>
                      {h.batteryCapacityKwh > 0 ? (
                        <>
                          <Gauge value={h.batteryChargeKwh} max={h.batteryCapacityKwh} compact />
                          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                            {h.batteryChargeKwh.toFixed(1)} / {h.batteryCapacityKwh} kWh
                          </div>
                        </>
                      ) : (
                        <span className="muted">{h.type === "prosumer" ? "no battery" : "—"}</span>
                      )}
                    </td>
                    <td>{h.storedKwh > 0 ? `${h.storedKwh.toFixed(2)} kWh` : <span className="muted">—</span>}</td>
                    <td>{h.type === "prosumer" ? h.settings.overflowMode : <span className="muted">—</span>}</td>
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
