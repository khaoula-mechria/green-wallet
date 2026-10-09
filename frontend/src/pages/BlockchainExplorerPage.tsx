import { useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { AssetBadge, TxTypeBadge } from "../components/Badge";
import { AccountId, Fee, Hash, TxId } from "../components/ledger";
import { PageHead, Readout, Readouts, Section } from "../components/ui";
import { fmtSimTime } from "../format";
import type { BlockDetail, BlockchainBlock, LedgerStatus } from "../types";

export function BlockchainExplorerPage() {
  const { data: status } = usePolling(() => api.get<LedgerStatus>("/blockchain/status"), 2500);
  const { data: blocks, loading } = usePolling(() => api.get<BlockchainBlock[]>("/blockchain/blocks?limit=100"), 2500);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const { data: blockDetail } = usePolling(
    () => (selectedIndex === null ? Promise.resolve(null) : api.get<BlockDetail>(`/blockchain/blocks/${selectedIndex}`)),
    5000,
    [selectedIndex]
  );

  const reversedBlocks = (blocks ?? []).slice().reverse();

  return (
    <div>
      <PageHead
        kicker="Ledger"
        title="Blockchain explorer"
        lede="Every block seals transactions and carries the hash of the block before it, so changing history would break every link after it. Hedera-style IDs on a simulated network; the operator account pays every fee."
      />

      <Section title="Network" note={status?.network}>
        <Readouts>
          <Readout label="Blocks" value={status?.blocksCount ?? "—"} />
          <Readout label="Transactions" value={status?.transactionsCount ?? "—"} />
          <Readout label="Fees paid by operator" value={(status?.totalFeesHbar ?? 0).toFixed(4)} unit="ℏ" sub={status ? <AccountId id={status.operatorAccountId} /> : undefined} />
          <Readout
            label="Token IDs"
            value={status?.tokenIds.TEC ?? "—"}
            unit="TEC"
            sub={status ? `SOLAR ${status.tokenIds.SOLAR} · WIND ${status.tokenIds.WIND}` : undefined}
          />
        </Readouts>
      </Section>

      <div className="card-grid card-grid-2">
        <Section title="Chain" note="Newest first. Each block links to the one below it.">
          <div className="table-scroll chain-scroll">
            {loading && !blocks ? (
              <div className="empty-state">Reading the chain…</div>
            ) : (
              <table className="chain-table">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Hash ← previous</th>
                    <th className="num">Txs</th>
                    <th>Sealed</th>
                  </tr>
                </thead>
                <tbody>
                  {reversedBlocks.map((b) => (
                    <tr
                      key={b.index}
                      onClick={() => setSelectedIndex(b.index)}
                      className={"clickable" + (selectedIndex === b.index ? " row-highlight" : "")}
                    >
                      <td className="mono">#{b.index}</td>
                      <td>
                        <Hash value={b.hash} groups={3} /> <span className="muted mono">← {b.previousHash.slice(0, 8)}</span>
                      </td>
                      <td className="num">{b.transactionIds.length}</td>
                      <td className="mono muted">{fmtSimTime(b.simTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>

        <Section title="Block record" note={blockDetail ? undefined : "Select a block to read it."} className="sticky-record">
          {!blockDetail ? (
            <div className="empty-state">No block selected.</div>
          ) : (
            <div>
              <div className="block-head">
                <b>#{blockDetail.index}</b>
                <span className="muted">{fmtSimTime(blockDetail.simTime)}</span>
                <span className="muted">· {blockDetail.transactions.length} transactions</span>
              </div>
              <dl className="block-fields">
                <div>
                  <dt>Hash</dt>
                  <dd>
                    <Hash value={blockDetail.hash} />
                  </dd>
                </div>
                <div>
                  <dt>Previous</dt>
                  <dd>
                    <Hash value={blockDetail.previousHash} />
                  </dd>
                </div>
                <div>
                  <dt>Nonce</dt>
                  <dd className="mono">{blockDetail.nonce}</dd>
                </div>
              </dl>
              {blockDetail.transactions.length === 0 ? (
                <div className="empty-state">Genesis block: no transactions.</div>
              ) : (
                <table className="dense">
                  <thead>
                    <tr>
                      <th>Transaction</th>
                      <th className="num">Amount</th>
                      <th className="num">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockDetail.transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>
                          <TxTypeBadge type={tx.type} asset={tx.asset} /> <AssetBadge asset={tx.asset} />
                          <span className="cell-sub">
                            <AccountId id={tx.fromAccountId} /> {tx.fromLabel} → <AccountId id={tx.toAccountId} /> {tx.toLabel}
                          </span>
                          <span className="cell-sub">
                            <TxId id={tx.id} />
                          </span>
                        </td>
                        <td className="num">{tx.amount.toFixed(tx.asset === "TEC" ? 2 : 3)}</td>
                        <td className="num">
                          <Fee hbar={tx.feeHbar} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
