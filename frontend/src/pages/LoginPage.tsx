import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/client";
import { TypeBadge } from "../components/Badge";
import { Brand } from "../components/brand";
import type { EnergySource, HouseholdType } from "../types";

const DEMO_ROSTER: Array<{ type: HouseholdType; ids: string[] }> = [
  { type: "producer", ids: ["producer-1", "producer-2"] },
  { type: "prosumer", ids: ["prosumer-1", "prosumer-2", "prosumer-3", "prosumer-4", "prosumer-5"] },
  { type: "consumer", ids: ["consumer-1", "consumer-2", "consumer-3", "consumer-4"] },
];

const TYPE_HINT: Record<HouseholdType, string> = {
  producer: "A large plant (solar or wind farm). Sells its whole output in the auction.",
  prosumer: "A home that generates and consumes. Can have a battery and rented storage.",
  consumer: "A home that only consumes. Buys locally, or imports from the utility.",
};

export function LoginPage() {
  const { household, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [id, setId] = useState("prosumer-2");
  const [password, setPassword] = useState("password123");

  const [name, setName] = useState("");
  const [type, setType] = useState<HouseholdType>("prosumer");
  const [location, setLocation] = useState("");
  const [energyType, setEnergyType] = useState<EnergySource>("solar");
  const [batteryCapacity, setBatteryCapacity] = useState("10");

  if (household) return <Navigate to="/" replace />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(id, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({
        name,
        type,
        location,
        password,
        energyType: type === "producer" ? energyType : undefined,
        batteryCapacityKwh: type === "prosumer" ? Number(batteryCapacity) : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">

      <main className="login-panel">
        <div className="login-brand">
          <Brand to="/login" />
        </div>
        <div className="login-card">
          <div className="tab-row">
            <button className={"tab-btn" + (mode === "login" ? " active" : "")} onClick={() => setMode("login")}>
              Sign in
            </button>
            <button className={"tab-btn" + (mode === "register" ? " active" : "")} onClick={() => setMode("register")}>
              Join the grid
            </button>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {mode === "login" ? (
            <>
              <form onSubmit={handleLogin}>
                <div className="field">
                  <label className="label">Household ID</label>
                  <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="prosumer-1" />
                </div>
                <div className="field">
                  <label className="label">Password</label>
                  <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
                  {submitting ? "Signing in…" : "Log in"}
                </button>
              </form>
              <div className="roster">
                <h3 className="sub-head">Demo households · password “password123”</h3>
                <table>
                  <tbody>
                    {DEMO_ROSTER.map((group) => (
                      <tr key={group.type}>
                        <td style={{ width: 110 }}>
                          <TypeBadge type={group.type} />
                        </td>
                        <td>
                          {group.ids.map((a) => (
                            <button
                              key={a}
                              type="button"
                              style={{ marginRight: 14 }}
                              onClick={() => {
                                setId(a);
                                setPassword("password123");
                              }}
                            >
                              {a}
                            </button>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <form onSubmit={handleRegister}>
              <div className="field">
                <label className="label">Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
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
                  <label className="label">Location</label>
                  <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} required />
                </div>
              </div>
              <p className="hint" style={{ marginTop: -8, marginBottom: 18 }}>
                {TYPE_HINT[type]}
              </p>
              {type === "prosumer" && (
                <div className="field">
                  <label className="label">Home battery, kWh (0 = none)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    value={batteryCapacity}
                    onChange={(e) => setBatteryCapacity(e.target.value)}
                    required
                  />
                </div>
              )}
              {type === "producer" && (
                <div className="field">
                  <label className="label">Energy source</label>
                  <select className="input" value={energyType} onChange={(e) => setEnergyType(e.target.value as EnergySource)}>
                    <option value="solar">Solar farm</option>
                    <option value="wind">Wind farm</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label className="label">Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
                {submitting ? "Creating…" : "Create account"}
              </button>
              {type !== "producer" && <p className="hint">You receive a 10 TEC welcome grant from the treasury.</p>}
            </form>
          )}
        </div>
        <Link className="card-link login-admin-link" to="/admin/login">
          Operator console →
        </Link>
      </main>
    </div>
  );
}
