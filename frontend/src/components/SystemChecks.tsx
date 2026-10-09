import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import type { ConservationChecks, MarketStatus } from "../types";

/** The five conservation checks (DESIGN §9): operator console. */
export function ChecksPanel({ checks }: { checks: ConservationChecks }) {
  const rows = [
    { label: "Money: balances equal the TEC in existence", ok: checks.money.ok, detail: `${checks.money.sumOfBalances.toFixed(2)} / ${checks.money.totalSupply.toFixed(2)}` },
    { label: "Clearing account back to zero", ok: checks.clearing.ok, detail: `${checks.clearing.balance.toFixed(2)}` },
    { label: "Energy: in equals out plus stored", ok: checks.energy.ok, detail: `${checks.energy.inputs.toFixed(2)} / ${checks.energy.outputs.toFixed(2)}` },
    { label: "Certificates: issued equals held plus retired", ok: checks.certificates.ok, detail: `${checks.certificates.issued.toFixed(2)} / ${checks.certificates.accounted.toFixed(2)}` },
    { label: "No negative balance anywhere", ok: checks.noNegative.ok, detail: "" },
  ];
  return (
    <ul className="checks">
      {rows.map((r) => (
        <li key={r.label}>
          <span className={"mark" + (r.ok ? "" : " alarm")}>{r.ok ? "✓" : "✗"}</span>
          <span>{r.label}</span>
          <span className="mono muted">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function SimControls({ onChange }: { onChange: () => Promise<void> }) {
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
    <div style={{ marginTop: 18 }}>
      <h3 className="sub-head">Demo simulation</h3>
      {error && <div className="alert alert-error">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {status.paused ? (
          <button className="btn btn-primary btn-small" onClick={() => run("resume")}>
            Resume
          </button>
        ) : (
          <button className="btn btn-secondary btn-small" onClick={() => run("pause")}>
            Pause
          </button>
        )}
        <button className="btn btn-secondary btn-small" onClick={() => run("step")}>
          Next interval
        </button>
        <button className="btn btn-danger btn-small" onClick={() => run("reset")}>
          Reset demo
        </button>
      </div>
    </div>
  );
}
