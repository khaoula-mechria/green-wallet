import { useState } from "react";
import { TxTypeBadge } from "./Badge";
import { TxId } from "./ledger";
import { fmtSimTime } from "../format";
import type { LedgerTx } from "../types";

/** What happened to one account's green certificates, read from its ledger movements. */
export function certificateCounts(txs: LedgerTx[], accountId: string) {
  let certified = 0;
  let passedOn = 0;
  let received = 0;
  let used = 0;
  for (const t of txs) {
    if (t.asset !== "SOLAR" && t.asset !== "WIND") continue;
    if (t.type === "CERT_ISSUE" && t.toAccountId === accountId) certified += t.amount;
    if (t.type === "CERT_TRANSFER" && t.fromAccountId === accountId) passedOn += t.amount;
    if (t.type === "CERT_TRANSFER" && t.toAccountId === accountId) received += t.amount;
    if (t.type === "CERT_RETIRE" && t.fromAccountId === accountId) used += t.amount;
  }
  return { certified, passedOn, received, used };
}

/** A green certificate in one sentence, and the life of one in three steps. */
export function CertificatesExplained({ counts, window }: { counts: ReturnType<typeof certificateCounts>; window: string }) {
  return (
    <>
      <p className="cert-oneliner">
        🌿 <b>1 certificate = proof that 1 kWh came from the sun or the wind.</b> It is created when green energy is produced, travels with that
        energy when it is sold, and is used up when someone consumes it, so the same green kWh is never counted twice.
      </p>
      <div className="cert-explain">
        <div className="cert-step">
          <span className="cert-step-emoji">☀️</span>
          <b>Produced → certified</b>
          <p>Green energy made</p>
          <span className="cert-count">
            {counts.certified.toFixed(2)}
            <small>kWh</small>
          </span>
        </div>
        <div className="cert-step">
          <span className="cert-step-emoji">🔁</span>
          <b>Sold → passed on</b>
          <p>Travelled with energy sold{counts.received > 0 ? `, ${counts.received.toFixed(2)} kWh received with energy bought` : ""}</p>
          <span className="cert-count">
            {counts.passedOn.toFixed(2)}
            <small>kWh</small>
          </span>
        </div>
        <div className="cert-step">
          <span className="cert-step-emoji">🏠</span>
          <b>Consumed → used up</b>
          <p>Green energy used</p>
          <span className="cert-count">
            {counts.used.toFixed(2)}
            <small>kWh</small>
          </span>
        </div>
      </div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
        Totals over {window}. All three are amounts (levels), in kWh.
      </p>
    </>
  );
}

type Tab = "money" | "certs" | "all";

/** One account's ledger, money and certificates kept apart so neither drowns the other. */
export function LedgerTable({ txs, accountId, limit = 40 }: { txs: LedgerTx[]; accountId: string; limit?: number }) {
  const [tab, setTab] = useState<Tab>("money");
  const rows = txs
    .filter((t) => (tab === "all" ? true : tab === "money" ? t.asset === "TEC" : t.asset === "SOLAR" || t.asset === "WIND"))
    .slice(0, limit);
  return (
    <div>
      <div className="seg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "money"} className={tab === "money" ? "active" : ""} onClick={() => setTab("money")}>
          💰 Money
        </button>
        <button role="tab" aria-selected={tab === "certs"} className={tab === "certs" ? "active" : ""} onClick={() => setTab("certs")}>
          🌿 Certificates
        </button>
        <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          All
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          {tab === "money" ? "No money movements in your recent ledger entries: no auction payment or trade lately." : "Nothing here yet."}
          {tab === "money" && txs.length > 0 && (
            <>
              {" "}
              <button className="text-button" onClick={() => setTab("certs")}>
                Show certificates
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>With</th>
                <th className="num">Amount</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const incoming = t.toAccountId === accountId;
                const kwh = t.asset !== "TEC";
                return (
                  <tr key={t.id} title={t.memo}>
                    <td className="mono muted">{fmtSimTime(t.simTime)}</td>
                    <td>
                      <TxTypeBadge type={t.type} asset={t.asset} />
                    </td>
                    <td className="muted">{incoming ? t.fromLabel : t.toLabel}</td>
                    <td className={"num " + (incoming ? "supply" : "")}>
                      {incoming ? "+" : "−"}
                      {t.amount.toFixed(kwh ? 3 : 2)}
                      <span className="q-unit">{kwh ? `kWh ${t.asset === "WIND" ? "🌬️" : "☀️"}` : "TEC"}</span>
                    </td>
                    <td>
                      <TxId id={t.id} compact />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
