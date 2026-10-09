import { useState } from "react";
import { api, ApiError } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { ActivityByDay } from "../components/Activity";
import { certificateCounts } from "../components/certificates";
import { useAuth } from "../context/AuthContext";
import { COLORS, Key, Legend, PageHead, Readout, Readouts, Section, SubHead } from "../components/ui";
import { fmtMoney } from "../format";
import type { LedgerTx, Wallet } from "../types";

export function WalletPage() {
  const { household, refresh } = useAuth();
  const { data: wallet, reload: reloadWallet } = usePolling(() => api.get<Wallet>(`/wallet/${household!.id}`), 2500, [household?.id]);
  const { data: history, loading } = usePolling(() => api.get<LedgerTx[]>(`/tokens/history/${household!.id}?limit=600`), 2500, [household?.id]);

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
  const counts = certificateCounts(history ?? [], accountId ?? "");
  const green = { produced: counts.certified, used: counts.used };
  const g = wallet?.greenShare;
  const used = g ? g.solarKwh + g.windKwh + g.greyKwh : 0;

  return (
    <div>
      <PageHead
        kicker="10 · My home"
        title={
          <>
            The <em>wallet</em>
          </>
        }
        lede="Your money (TEC: one TEC is one unit of money), how green your energy is, the utility's bill, and everything that happened day by day."
      />

      <Section num="10.1" title="Balance" note="What you can spend now, and what is set aside for the auction in progress.">
        <div className="columns-wide">
          <Readouts>
            <Readout hero label="Available · level" value={(wallet?.availableTec ?? 0).toFixed(2)} unit="TEC" />
            <Readout label="Held for the auction · level" value={(wallet?.reservedTec ?? 0).toFixed(2)} unit="TEC" sub="released when the half hour settles" />
          </Readouts>
          <div>
            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
            <div className="field">
              <label className="label">Amount, TEC</label>
              <input className="input" type="number" min="0.01" max={wallet?.topupMaxTec} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-primary" disabled={busy || !amount || !wallet?.topupsEnabled} onClick={() => move("topup")}>
                Top up
              </button>
              <button className="btn btn-secondary" disabled={busy || !amount || !wallet?.topupsEnabled} onClick={() => move("cashout")}>
                Cash out
              </button>
            </div>
            <p className="hint">Demo only: payments are simulated, up to {wallet?.topupMaxTec ?? 100} TEC at a time.</p>
          </div>
        </div>
      </Section>

      <Section title="Green energy" note="Solar and wind energy you produced and used, and how green everything you consumed was.">
        <Readouts>
          <Readout label="☀️ You produced · level" value={green.produced.toFixed(2)} unit="kWh" sub="green energy, recent days" tone="supply" />
          <Readout label="🏠 Green energy you used · level" value={green.used.toFixed(2)} unit="kWh" sub="from the sun or the wind" />
          <Readout label="🔋 Green energy kept for later · level" value={((wallet?.certificates.solar ?? 0) + (wallet?.certificates.wind ?? 0)).toFixed(2)} unit="kWh" sub="in your battery or rented space" />
        </Readouts>
        <div style={{ height: 16 }} />
        <div className="columns">
          <div>
            <SubHead>Of everything you consumed · {g?.percentGreen ?? 0}% green</SubHead>
            {used > 0 && g ? (
              <>
                <div style={{ display: "flex", gap: 2, height: 22, marginBottom: 10 }}>
                  {[
                    { v: g.solarKwh, c: COLORS.sun },
                    { v: g.windKwh, c: COLORS.wind },
                    { v: g.greyKwh, c: COLORS.grey },
                  ]
                    .filter((x) => x.v > 0)
                    .map((x, i) => (
                      <span key={i} style={{ flex: x.v, background: x.c }} />
                    ))}
                </div>
                <Legend>
                  <Key kind="dot" color={COLORS.sun}>
                    ☀️ Solar {g.solarKwh.toFixed(2)} kWh
                  </Key>
                  <Key kind="dot" color={COLORS.wind}>
                    🌬️ Wind {g.windKwh.toFixed(2)} kWh
                  </Key>
                  <Key kind="dot" color={COLORS.grey}>
                    ⚫ Grey, from the utility {g.greyKwh.toFixed(2)} kWh
                  </Key>
                </Legend>
              </>
            ) : (
              <div className="empty-state">Nothing consumed yet.</div>
            )}
          </div>
          <div>
            <SubHead>What "green" means</SubHead>
            <p className="hint" style={{ marginTop: 0 }}>
              Energy from the sun or the wind is counted as green from the moment it is produced until it is used, even when it passes through a
              battery or a neighbour. Energy from the utility counts as grey.
            </p>
          </div>
        </div>
      </Section>

      <Section num="10.3" title="Utility statement" note="Energy the microgrid could not supply came from the utility, and spare energy nobody bought went to it. The utility bills you separately; it never cuts you off.">
        <table style={{ maxWidth: 560 }}>
          <tbody>
            <tr>
              <td>Imported · {(wallet?.utility.importedKwh ?? 0).toFixed(2)} kWh bought from the utility</td>
              <td className="num demand">{fmtMoney(-(wallet?.utility.importCost ?? 0))}</td>
            </tr>
            <tr>
              <td>Exported · {(wallet?.utility.exportedKwh ?? 0).toFixed(2)} kWh sold to the utility</td>
              <td className="num supply">+{(wallet?.utility.exportCredit ?? 0).toFixed(2)}</td>
            </tr>
            <tr>
              <td style={{ borderTop: "1px solid var(--ink)", borderBottom: "3px double var(--ink)", fontWeight: 600 }}>Balance this period</td>
              <td className="num" style={{ borderTop: "1px solid var(--ink)", borderBottom: "3px double var(--ink)", fontWeight: 600 }}>
                {fmtMoney(wallet?.utility.net ?? 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Your activity" note="Summed per day. Open a day to see what happened in it.">
        {loading && !history ? <div className="empty-state">Reading your activity…</div> : <ActivityByDay txs={history ?? []} accountId={accountId ?? ""} maxDays={14} />}
      </Section>
    </div>
  );
}
