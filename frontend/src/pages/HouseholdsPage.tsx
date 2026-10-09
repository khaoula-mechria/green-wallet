import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { TypeBadge } from "../components/Badge";
import { MiniBattery, PageHead, Section } from "../components/ui";
import type { Household, HouseholdType } from "../types";

const SOURCE = { solar: "solar", wind: "wind", grid: "—" } as const;
const GROUPS: Array<{ type: HouseholdType; title: string; note: string }> = [
  { type: "producer", title: "Producers", note: "Solar and wind farms. They sell their whole output in the auction." },
  { type: "prosumer", title: "Prosumers", note: "Homes that produce and consume, most with a battery." },
  { type: "consumer", title: "Consumers", note: "Homes that only consume: they buy locally, or import." },
];

export function HouseholdsPage() {
  const { household: me } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = usePolling(() => api.get<Household[]>("/households"), 2500);

  return (
    <div>
      <PageHead
        kicker="03 · The grid"
        title={
          <>
            Who is <em>on the grid</em>
          </>
        }
        lede="Every participant in the microgrid, grouped by role, with what they are producing and using in this half hour. Open any of them to see their profile."
      />
      {loading && !data ? (
        <div className="empty-state">Reading the register…</div>
      ) : (
        GROUPS.map((g, i) => {
          const rows = (data ?? []).filter((h) => h.type === g.type);
          if (rows.length === 0) return null;
          return (
            <Section key={g.type} num={`3.${i + 1}`} title={g.title} note={g.note}>
              <table>
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Source</th>
                    <th className="num">Made · kWh/30 min</th>
                    <th className="num">Used · kWh/30 min</th>
                    <th className="num">Net · kWh/30 min</th>
                    {g.type === "prosumer" && <th style={{ width: 210 }}>Home battery</th>}
                    {g.type !== "producer" && <th className="num">Rented space · kWh</th>}
                    {g.type === "prosumer" && <th>Mode</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const net = h.currentProduction - h.currentConsumption;
                    return (
                      <tr key={h.id} className={"clickable" + (h.id === me?.id ? " row-highlight" : "")} onClick={() => navigate(`/households/${h.id}`)}>
                        <td>
                          <Link className="cell-name cell-link" to={`/households/${h.id}`} onClick={(e) => e.stopPropagation()}>
                            {h.name}
                          </Link>
                          <span className="cell-sub">{h.location}</span>
                        </td>
                        <td className="muted">{SOURCE[h.energyType]}</td>
                        <td className="num">{h.currentProduction.toFixed(2)}</td>
                        <td className="num">{h.currentConsumption.toFixed(2)}</td>
                        <td className={"num " + (net >= 0 ? "supply" : "demand")}>
                          {net >= 0 ? "+" : "−"}
                          {Math.abs(net).toFixed(2)}
                        </td>
                        {g.type === "prosumer" && (
                          <td>
                            {h.batteryCapacityKwh > 0 ? (
                              <MiniBattery value={h.batteryChargeKwh} max={h.batteryCapacityKwh} />
                            ) : (
                              <span className="muted">no battery</span>
                            )}
                          </td>
                        )}
                        {g.type !== "producer" && <td className="num">{h.storedKwh > 0 ? h.storedKwh.toFixed(2) : <span className="muted">—</span>}</td>}
                        {g.type === "prosumer" && <td className="muted">{h.settings.overflowMode}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          );
        })
      )}
      {me && (
        <p className="hint" style={{ marginTop: 18 }}>
          Highlighted: you, <TypeBadge type={me.type} />.
        </p>
      )}
    </div>
  );
}
