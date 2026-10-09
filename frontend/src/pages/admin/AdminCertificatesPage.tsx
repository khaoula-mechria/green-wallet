import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { AssetBadge, TxTypeBadge } from "../../components/Badge";
import { CertificatesExplained } from "../../components/certificates";
import { AccountId, TxId } from "../../components/ledger";
import { PageHead, Readout, Readouts, Section } from "../../components/ui";
import { fmtSimTime } from "../../format";
import type { DashboardSummary, LedgerTx } from "../../types";

/** Green certificates across the grid: what households see only as "produced" and "green energy used". */
export function AdminCertificatesPage() {
  const { data: txs } = usePolling(() => api.get<LedgerTx[]>("/transactions?limit=1000&asset=CERT"), 5000);
  const { data: summary } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 5000);

  const list = txs ?? [];
  const sum = (type: string, asset?: string) => list.filter((t) => t.type === type && (!asset || t.asset === asset)).reduce((s, t) => s + t.amount, 0);
  const counts = { certified: sum("CERT_ISSUE"), passedOn: sum("CERT_TRANSFER"), received: 0, used: sum("CERT_RETIRE") };
  const toUtility = list.filter((t) => t.type === "CERT_TRANSFER" && t.toAccountId === "0.0.1004").reduce((s, t) => s + t.amount, 0);
  const check = summary?.checks.certificates;

  return (
    <div>
      <PageHead
        kicker="Operator console"
        title="Green certificates"
        lede="SOLAR and WIND certificates (1 per kWh) are issued on production, travel with the energy, and are retired on consumption. Households only see this as “produced” and “green energy used”."
      />

      <Section title="Network" note="Totals over the last 1,000 certificate movements.">
        <Readouts>
          <Readout label="Issued · SOLAR" value={sum("CERT_ISSUE", "SOLAR").toFixed(2)} unit="kWh" />
          <Readout label="Issued · WIND" value={sum("CERT_ISSUE", "WIND").toFixed(2)} unit="kWh" />
          <Readout label="Retired on use" value={counts.used.toFixed(2)} unit="kWh" />
          <Readout label="Handed to the utility" value={toUtility.toFixed(2)} unit="kWh" sub="with exported energy" />
          <Readout
            label="Invariant"
            value={check ? (check.ok ? "✓ holds" : "✗ broken") : "—"}
            sub={check ? `issued ${check.issued.toFixed(2)} = held + retired ${check.accounted.toFixed(2)}` : undefined}
          />
        </Readouts>
      </Section>

      <Section title="Green certificates" note="The life of a certificate, with network totals.">
        <CertificatesExplained counts={counts} window="the last 1,000 certificate movements" />
      </Section>

      <Section title="Ledger" note="Newest first.">
        <div className="table-scroll" style={{ maxHeight: 640 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Movement</th>
                <th>From → to</th>
                <th className="num">kWh</th>
                <th>Asset</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((t) => (
                <tr key={t.id} title={t.memo}>
                  <td className="mono muted">{fmtSimTime(t.simTime)}</td>
                  <td>
                    <TxTypeBadge type={t.type} asset={t.asset} />
                  </td>
                  <td>
                    {t.fromLabel} → {t.toLabel}
                    <span className="cell-sub">
                      <AccountId id={t.fromAccountId} /> → <AccountId id={t.toAccountId} />
                    </span>
                  </td>
                  <td className="num">{t.amount.toFixed(3)}</td>
                  <td>
                    <AssetBadge asset={t.asset} />
                  </td>
                  <td>
                    <TxId id={t.id} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
