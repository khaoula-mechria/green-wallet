import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { SharedBatteryPanel } from "../../components/SharedBatteryPanel";
import { ChecksPanel, SimControls } from "../../components/SystemChecks";
import { AccountId } from "../../components/ledger";
import { KV, PageHead, Readout, Readouts, Section } from "../../components/ui";
import type { DashboardSummary, LedgerStatus, MarketStatus } from "../../types";

/** The whole system at a glance: integrity, money supply, ledger, prices and storage internals. */
export function AdminOverviewPage() {
  const { data, reload } = usePolling(() => api.get<DashboardSummary>("/dashboard"), 2500);
  const { data: ledger } = usePolling(() => api.get<LedgerStatus>("/blockchain/status"), 5000);
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 2500);

  if (!data) return <div className="page-loading">Reading the system…</div>;
  const c = status?.band.components;

  return (
    <div>
      <PageHead kicker="Operator console" title="System overview" lede="Integrity checks, money supply, the ledger and the parameters behind every price. None of this is shown to households." />

      <Section title="Money and ledger" note="TEC is the payment token; every movement is a ledger transaction sealed in its own block.">
        <Readouts>
          <Readout label="TEC held by households" value={data.tokenCirculation.toFixed(2)} unit="TEC" />
          <Readout label="Treasury" value={data.treasuryBalance.toFixed(2)} unit="TEC" sub={<AccountId id="0.0.1001" />} />
          <Readout label="Transactions" value={ledger?.transactionsCount ?? "—"} sub={`${ledger?.blocksCount ?? "—"} blocks`} />
          <Readout label="Network fees" value={(ledger?.totalFeesHbar ?? 0).toFixed(4)} unit="ℏ" sub={<>paid by <AccountId id={ledger?.operatorAccountId} /></>} />
        </Readouts>
      </Section>

      <div className="card-grid card-grid-2">
        <Section title="System integrity" note={`${data.counts.producers} producers · ${data.counts.prosumers} prosumers · ${data.counts.consumers} consumers`}>
          <ChecksPanel checks={data.checks} />
          <SimControls onChange={reload} />
        </Section>

        <Section title="Price band" note="The utility's prices, built from cost components (DESIGN §3.1).">
          {status && c ? (
            <>
              <pre className="formula">
                ceiling = {c.wholesale.toFixed(2)} + {c.networkFee.toFixed(2)} + {c.taxes.toFixed(2)} + {c.supplierMargin.toFixed(2)} = <b>{status.band.ceiling.toFixed(2)}</b>
                {"\n"}floor   = {c.wholesale.toFixed(2)} − {c.balancingCost.toFixed(2)} = <b>{status.band.floor.toFixed(2)}</b>
                {"\n"}middle  = ({status.band.floor.toFixed(2)} + {status.band.ceiling.toFixed(2)}) / 2 = <b>{status.band.mid.toFixed(3)}</b>
              </pre>
              <KV
                rows={[
                  ["Market interval", `${status.intervalMs / 1000} s real = 30 simulated min`],
                  ["Interval number", status.interval],
                  ["Token IDs (simulated)", ledger ? `TEC ${ledger.tokenIds.TEC} · SOLAR ${ledger.tokenIds.SOLAR} · WIND ${ledger.tokenIds.WIND}` : "—"],
                  ["Network", ledger?.network ?? "—"],
                ]}
              />
            </>
          ) : (
            <div className="empty-state">…</div>
          )}
        </Section>
      </div>

      <Section title="Community battery" note="Rented compartment, grid pool, decay and the pool's trading limits.">
        <SharedBatteryPanel status={data.sharedBattery} />
      </Section>
    </div>
  );
}
