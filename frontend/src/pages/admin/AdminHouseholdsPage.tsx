import { useState } from "react";
import { api, ApiError } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { TypeBadge } from "../../components/Badge";
import { AccountId } from "../../components/ledger";
import { MiniBattery, PageHead, Section } from "../../components/ui";
import type { EnergySource, Household, HouseholdType } from "../../types";

const ROLE_HINT: Record<HouseholdType, string> = {
  producer: "A solar or wind farm. Sells its whole output in the auction; no welcome grant.",
  prosumer: "A home with rooftop solar and, optionally, a battery. Gets the welcome grant.",
  consumer: "A home that only consumes. Gets the welcome grant.",
};

/** Every participant with its ledger account, balances, stocks and agent settings, plus the operator's actions. */
export function AdminHouseholdsPage() {
  const { data, reload } = usePolling(() => api.get<Household[]>("/households"), 2500);

  return (
    <div>
      <PageHead kicker="Operator console" title="Households" lede="Add participants to the microgrid, credit their wallets, and see the full register with accounts, balances and agent limits." />

      <div className="card-grid card-grid-2">
        <Section title="Add a household" note="Same rules as a self-registration. The new household signs in with its login ID and this password.">
          <AddHouseholdForm onAdded={reload} />
        </Section>
        <Section title="Credit TEC" note="Moves TEC from the treasury to a household's wallet: the money supply does not change.">
          <CreditForm households={data ?? []} onCredited={reload} />
        </Section>
      </div>

      <Section title="Register" note={`${data?.length ?? "—"} participants`}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Account</th>
                <th className="num">Balance · TEC</th>
                <th className="num">Held · TEC</th>
                <th>Home battery</th>
                <th className="num">Rented · kWh</th>
                <th className="num">Listed · kWh</th>
                <th className="num">Sell ≥ · TEC/kWh</th>
                <th className="num">Buy ≤ · TEC/kWh</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((h) => (
                <tr key={h.id}>
                  <td>
                    <span className="cell-name">{h.name}</span>
                    <span className="cell-sub">
                      <TypeBadge type={h.type} /> · {h.id}
                    </span>
                  </td>
                  <td>
                    <AccountId id={h.accountId} />
                  </td>
                  <td className="num">{h.tokenBalance.toFixed(2)}</td>
                  <td className="num">{h.reservedTec.toFixed(2)}</td>
                  <td>{h.batteryCapacityKwh > 0 ? <MiniBattery value={h.batteryChargeKwh} max={h.batteryCapacityKwh} /> : <span className="muted">—</span>}</td>
                  <td className="num">{h.storedKwh.toFixed(2)}</td>
                  <td className="num">{h.reservedInOffersKwh.toFixed(2)}</td>
                  <td className="num">{h.settings.minSellPrice.toFixed(3)}</td>
                  <td className="num">{h.type === "producer" ? "—" : h.settings.maxBuyPrice.toFixed(3)}</td>
                  <td className="muted">{h.settings.auctionOptOut ? "opted out" : h.type === "prosumer" ? h.settings.overflowMode : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function AddHouseholdForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [type, setType] = useState<HouseholdType>("prosumer");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [location, setLocation] = useState("");
  const [password, setPassword] = useState("");
  const [energyType, setEnergyType] = useState<EnergySource>("solar");
  const [battery, setBattery] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const h = await api.post<Household>("/admin/households", {
        name,
        type,
        password,
        ...(id.trim() ? { id: id.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(type === "producer" ? { energyType } : {}),
        ...(type === "prosumer" ? { batteryCapacityKwh: Number(battery) } : {}),
      });
      setSuccess(`Added ${h.name} (${h.type}). Login ID: ${h.id}`);
      setName("");
      setId("");
      setLocation("");
      setPassword("");
      await onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the household");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="form-row">
        <div className="field">
          <label className="label">Role</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as HouseholdType)}>
            <option value="prosumer">Prosumer</option>
            <option value="consumer">Consumer</option>
            <option value="producer">Producer</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </div>
      </div>
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
        {ROLE_HINT[type]}
      </p>
      <div className="form-row">
        <div className="field">
          <label className="label">Login ID (optional)</label>
          <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="generated if empty" pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}" />
        </div>
        <div className="field">
          <label className="label">Location</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
        </div>
      </div>
      <div className="form-row">
        {type === "producer" && (
          <div className="field">
            <label className="label">Energy source</label>
            <select className="input" value={energyType} onChange={(e) => setEnergyType(e.target.value as EnergySource)}>
              <option value="solar">Solar farm</option>
              <option value="wind">Wind farm</option>
            </select>
          </div>
        )}
        {type === "prosumer" && (
          <div className="field">
            <label className="label">Home battery · kWh (0 = none)</label>
            <input className="input" type="number" min={0} max={50} step={0.5} value={battery} onChange={(e) => setBattery(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add household"}
      </button>
    </form>
  );
}

function CreditForm({ households, onCredited }: { households: Household[]; onCredited: () => Promise<void> }) {
  const [id, setId] = useState("");
  const [amount, setAmount] = useState("20");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = id || households[0]?.id || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const h = await api.post<Household>(`/admin/households/${encodeURIComponent(chosen)}/credit`, { amount: Number(amount) });
      setSuccess(`Credited ${Number(amount).toFixed(2)} TEC to ${h.name}. New balance: ${h.tokenBalance.toFixed(2)} TEC.`);
      await onCredited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not credit the household");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="field">
        <label className="label">Household</label>
        <select className="input" value={chosen} onChange={(e) => setId(e.target.value)}>
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} · {h.type} · {h.tokenBalance.toFixed(2)} TEC
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label">Amount · TEC</label>
        <input className="input" type="number" min={0.01} max={1000} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <button className="btn btn-primary" disabled={busy || !chosen}>
        {busy ? "Crediting…" : "Credit TEC"}
      </button>
      <p className="hint">Useful when a household's wallet has run dry and it can no longer buy from neighbours.</p>
    </form>
  );
}
