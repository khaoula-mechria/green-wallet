import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { AssetBadge, TxTypeBadge } from "../components/Badge";
import { fmtMoney, fmtSimTime, shortId } from "../format";
import type { LedgerTx, Wallet } from "../types";

export function WalletPage() {
  const { household, refresh } = useAuth();
  const { data: wallet, reload: reloadWallet } = usePolling(() => api.get<Wallet>(`/wallet/${household!.id}`), 2500, [household?.id]);
  const { data: history, loading } = usePolling(() => api.get<LedgerTx[]>(`/tokens/history/${household!.id}?limit=150`), 2500, [household?.id]);

  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function move(kind: "topup" | "cashout") {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await api.post<Wallet>(`/wallet/${kind}`, { amount: Number(amount) });
      setSuccess(kind === "topup" ? `Added ${Number(amount).toFixed(2)} TEC (simulated payment).` : `Cashed out ${Number(amount).toFixed(2)} TEC (simulated bank transfer).`);
      setAmount("");
      await reloadWallet();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  const accountId = household?.accountId;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Wallet</h1>
          <p>Your TEC (1 TEC = 1 unit of money), green certificates, and the utility statement.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Available TEC" value={(wallet?.availableTec ?? 0).toFixed(2)} sub={`total ${(wallet?.tokenBalance ?? 0).toFixed(2)} TEC`} />
        <StatCard label="Reserved for the auction" value={(wallet?.reservedTec ?? 0).toFixed(2)} sub="released when the interval settles" />
        <StatCard label="Account (simulated Hedera)" value={wallet?.accountId ?? "—"} sub="fees paid by the operator" />
        <StatCard label="Green share of my consumption" value={`${wallet?.greenShare.percentGreen ?? 0}%`} />
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="section-title">Top up / cash out</div>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <div className="field">
            <label className="label">Amount (TEC)</label>
            <input className="input" type="number" min="0.01" max={wallet?.topupMaxTec} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={busy || !amount || !wallet?.topupsEnabled} onClick={() => move("topup")}>
              Top up
            </button>
            <button className="btn btn-secondary" disabled={busy || !amount || !wallet?.topupsEnabled} onClick={() => move("cashout")}>
              Cash out
            </button>
          </div>
          <p className="hint">Demo only: payments are simulated. Max {wallet?.topupMaxTec ?? 100} TEC per top-up.</p>
        </div>

        <div className="card">
          <div className="section-title">Green certificates</div>
          <div className="kv-list">
            <div>
              <span>☀ Solar held (with my stored energy)</span>
              <strong>{(wallet?.certificates.solar ?? 0).toFixed(2)} kWh</strong>
            </div>
            <div>
              <span>🌬 Wind held</span>
              <strong>{(wallet?.certificates.wind ?? 0).toFixed(2)} kWh</strong>
            </div>
            <div>
              <span>Consumed solar</span>
              <strong>{(wallet?.greenShare.solarKwh ?? 0).toFixed(2)} kWh</strong>
            </div>
            <div>
              <span>Consumed wind</span>
              <strong>{(wallet?.greenShare.windKwh ?? 0).toFixed(2)} kWh</strong>
            </div>
            <div>
              <span>Consumed grey (utility)</span>
              <strong>{(wallet?.greenShare.greyKwh ?? 0).toFixed(2)} kWh</strong>
            </div>
          </div>
          <p className="hint">Certificates follow the kWh and are retired when the energy is consumed.</p>
        </div>

        <div className="card">
          <div className="section-title">Utility statement (real money, off-ledger)</div>
          <div className="kv-list">
            <div>
              <span>Imported {(wallet?.utility.importedKwh ?? 0).toFixed(2)} kWh</span>
              <strong className="neg">{fmtMoney(-(wallet?.utility.importCost ?? 0))}</strong>
            </div>
            <div>
              <span>Exported {(wallet?.utility.exportedKwh ?? 0).toFixed(2)} kWh</span>
              <strong className="pos">+{(wallet?.utility.exportCredit ?? 0).toFixed(2)}</strong>
            </div>
            <div>
              <span>Net this period</span>
              <strong className={(wallet?.utility.net ?? 0) >= 0 ? "pos" : "neg"}>{fmtMoney(wallet?.utility.net ?? 0)}</strong>
            </div>
          </div>
          <p className="hint">The main utility is the last resort: it never cuts you off, it bills you.</p>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Ledger history</div>
        {loading && !history ? (
          <div className="empty-state">Loading…</div>
        ) : !history || history.length === 0 ? (
          <div className="empty-state">No transactions yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Asset</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Amount</th>
                  <th>Memo</th>
                  <th>Tx ID</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((tx) => {
                  const incoming = tx.toAccountId === accountId;
                  const unit = tx.asset === "TEC" ? "" : " kWh";
                  return (
                    <tr key={tx.id}>
                      <td>
                        <TxTypeBadge type={tx.type} asset={tx.asset} />
                      </td>
                      <td>
                        <AssetBadge asset={tx.asset} />
                      </td>
                      <td>{tx.fromLabel}</td>
                      <td>{tx.toLabel}</td>
                      <td className={incoming ? "pos" : "neg"}>
                        {incoming ? "+" : "−"}
                        {tx.amount.toFixed(tx.asset === "TEC" ? 2 : 3)}
                        {unit}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {tx.memo}
                      </td>
                      <td className="mono" title={tx.id}>
                        {shortId(tx.id, 20)}
                      </td>
                      <td className="muted">{fmtSimTime(tx.simTime)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
