import { useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { AccountId, Fee, TxId } from "../components/ledger";
import { TxTypeBadge } from "../components/Badge";
import { PageHead, Section } from "../components/ui";
import { fmtSimTime } from "../format";
import type { LedgerTx } from "../types";

const FILTERS = [
  { value: "TEC", label: "💰 Money (TEC)" },
  { value: "CERT", label: "🌿 Green certificates" },
  { value: "RECORD", label: "🧾 Auction records" },
  { value: "ALL", label: "Everything" },
];

export function TransactionsPage() {
  const [asset, setAsset] = useState("TEC");
  const { data, loading } = usePolling(() => api.get<LedgerTx[]>(`/transactions?limit=150&asset=${asset}`), 2500, [asset]);

  return (
    <div>
      <PageHead
        kicker="11 · The ledger"
        title={
          <>
            Every <em>movement</em>, on the record
          </>
        }
        lede="The public ledger of the microgrid. Pick what to show: money, green certificates or auction records. Hover a row for its memo."
      />
      <Section
        num="11.1"
        title="The feed"
        note={
          <>
            Showing
            <select className="input" style={{ marginTop: 6 }} value={asset} onChange={(e) => setAsset(e.target.value)}>
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </>
        }
      >
        {loading && !data ? (
          <div className="empty-state">Reading the ledger…</div>
        ) : !data || data.length === 0 ? (
          <div className="empty-state">Nothing recorded yet.</div>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 720 }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>From → to</th>
                  <th className="num">Amount</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {data.map((tx) => {
                  const kwh = tx.asset === "SOLAR" || tx.asset === "WIND";
                  return (
                    <tr key={tx.id} title={tx.memo}>
                      <td className="mono muted">{fmtSimTime(tx.simTime)}</td>
                      <td>
                        <TxTypeBadge type={tx.type} asset={tx.asset} />
                      </td>
                      <td>
                        {tx.fromLabel} <span className="muted">→</span> {tx.toLabel}
                        <span className="cell-sub">
                          <AccountId id={tx.fromAccountId} /> → <AccountId id={tx.toAccountId} />
                        </span>
                      </td>
                      <td className="num">
                        {tx.asset === "RECORD" ? (
                          <span className="muted">record</span>
                        ) : (
                          <>
                            {tx.amount.toFixed(kwh ? 3 : 2)}
                            <span className="q-unit">{kwh ? `kWh ${tx.asset === "WIND" ? "🌬️" : "☀️"}` : "TEC"}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <TxId id={tx.id} compact />
                        <span className="cell-sub mono">
                          {tx.blockIndex === null ? "pending" : `block #${tx.blockIndex}`} · fee <Fee hbar={tx.feeHbar} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
