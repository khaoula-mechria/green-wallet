import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/client";
import type { HouseholdType } from "../types";

export function LoginPage() {
  const { household, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [id, setId] = useState("producer-1");
  const [password, setPassword] = useState("password123");

  const [name, setName] = useState("");
  const [type, setType] = useState<HouseholdType>("producer");
  const [location, setLocation] = useState("");

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
      await register({ name, type, location, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand" style={{ padding: "0 0 18px" }}>
          <span className="dot" />
          Green Wallet
        </div>
        <div className="tab-row">
          <button className={"tab-btn" + (mode === "login" ? " active" : "")} onClick={() => setMode("login")}>
            Log in
          </button>
          <button className={"tab-btn" + (mode === "register" ? " active" : "")} onClick={() => setMode("register")}>
            Register
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {mode === "login" ? (
          <form onSubmit={handleLogin}>
            <div className="field">
              <label className="label">Household ID</label>
              <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="producer-1" />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
              {submitting ? "Signing in…" : "Log in"}
            </button>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 14 }}>
              Demo accounts: producer-1..5 / consumer-1..5, password "password123".
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <div className="field">
              <label className="label">Household name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label">Type</label>
                <select className="input" value={type} onChange={(e) => setType(e.target.value as HouseholdType)}>
                  <option value="producer">Producer</option>
                  <option value="consumer">Consumer</option>
                  <option value="prosumer">Prosumer</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Location</label>
                <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} required />
              </div>
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={submitting}>
              {submitting ? "Creating…" : "Create household"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
