import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, getOperatorToken, setOperatorToken } from "../../api/client";
import { Brand } from "../../components/brand";

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (getOperatorToken()) return <Navigate to="/admin" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await api.post<{ token: string }>("/auth/operator-login", { password });
      setOperatorToken(token);
      navigate("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <main className="login-panel">
        <div className="login-brand">
          <Brand to="/login" />
        </div>
        <div className="login-card">
          <h1 className="admin-login-title">Operator console</h1>
          <p className="hint" style={{ marginTop: 4, marginBottom: 18 }}>
            Ledger, blocks, certificates, the full auction book and system checks.
          </p>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label className="label">Operator password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !password}>
              {busy ? "Signing in…" : "Open the console"}
            </button>
          </form>
          <p className="hint">Demo password: “operator123”.</p>
          <Link className="card-link" to="/login" style={{ marginTop: 14 }}>
            ← Household sign-in
          </Link>
        </div>
      </main>
    </div>
  );
}
