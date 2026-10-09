import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { TypeBadge } from "../../components/Badge";
import { PriceChart } from "../../components/PriceChart";
import { MeritOrderChart } from "../../components/MeritOrderChart";
import { PageHead, Readout, Readouts, Section, SubHead } from "../../components/ui";
import { fmtClock, fmtPrice } from "../../format";
import type { AuctionBid, AuctionResult, MarketStatus, PricePoint } from "../../types";

const SOURCE_LABEL: Record<AuctionBid["source"], string> = {
  surplus: "surplus now",
  storage: "stored energy",
  battery: "home battery",
  "grid-pool": "grid pool",
  deficit: "deficit",
};

export function AdminAuctionPage() {
  const household = null as { id: string } | null;
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 1000);
  const { data: auction } = usePolling(() => api.get<AuctionResult | null>("/market/auctions/latest"), 2500);
  const { data: history } = usePolling(() => api.get<PricePoint[]>("/market/price-history?limit=96"), 2500);

  if (!status) return <div className="empty-state">Opening the order book…</div>;

  const sells = (auction?.bids ?? []).filter((b) => b.side === "sell").sort((a, b) => a.limitPrice - b.limitPrice);
  const buys = (auction?.bids ?? []).filter((b) => b.side === "buy").sort((a, b) => b.limitPrice - a.limitPrice);
  const c = status.band.components;

  return (
    <div>
      <PageHead
        kicker="Operator console"
        title="Auction book"
        lede={`Every ${status.intervalMs / 1000} seconds (30 simulated minutes) all the automatic bids meet. Sellers line up from cheapest, buyers from most eager, and everyone trades at a single price — a uniform-price double auction.`}
      />

      <Section num="4.1" title="The last auction" note={auction ? `Settled for ${fmtClock(auction.simTime)}.` : "Waiting for the first one."}>
        <Readouts>
          <Readout hero label="Cleared at · price" value={fmtPrice(auction?.clearingPrice)} unit="TEC/kWh" />
          <Readout label="Matched · rate" value={(auction?.volume ?? 0).toFixed(2)} unit="kWh/30 min" />
          <Readout label="Exported · rate" value={(auction?.exportedKwh ?? 0).toFixed(2)} unit="kWh/30 min" sub={`unsold, at the floor ${status.band.floor.toFixed(2)}`} tone="supply" />
          <Readout label="Imported · rate" value={(auction?.importedKwh ?? 0).toFixed(2)} unit="kWh/30 min" sub={`unmet, at the ceiling ${status.band.ceiling.toFixed(2)}`} tone="demand" />
        </Readouts>
      </Section>

      <Section num="4.2" title="Supply meets demand" note="The price sits halfway between the last seller and the last buyer who matched. A bid is a limit, never the price paid.">
        {auction ? <MeritOrderChart auction={auction} band={status.band} /> : <div className="empty-state">Waiting for the first auction…</div>}
      </Section>

      <Section num="4.3" title="Price band" note="The utility's prices bound every bid.">
        <div>
          <div>
            <SubHead>Where the band comes from</SubHead>
            <pre className="formula">
              ceiling = {c.wholesale.toFixed(2)} + {c.networkFee.toFixed(2)} + {c.taxes.toFixed(2)} + {c.supplierMargin.toFixed(2)} = <b>{status.band.ceiling.toFixed(2)}</b>
              {"\n"}floor   = {c.wholesale.toFixed(2)} − {c.balancingCost.toFixed(2)} = <b>{status.band.floor.toFixed(2)}</b>
              {"\n"}middle  = ({status.band.floor.toFixed(2)} + {status.band.ceiling.toFixed(2)}) / 2 = <b>{status.band.mid.toFixed(3)}</b>
            </pre>
            <p className="hint">Wholesale energy, network fee, taxes and margin make the utility's import price; wholesale minus its balancing cost is what it pays for exports.</p>
          </div>
        </div>
      </Section>

      <Section num="4.4" title="The order book" note="Highlighted: your own bids.">
        <div className="columns">
          <BidTable title="Sellers · cheapest first" bids={sells} myId={household?.id} />
          <BidTable title="Buyers · most eager first" bids={buys} myId={household?.id} />
        </div>
      </Section>

      <Section num="4.5" title="Price history" note="Low at noon when the sun floods the market; dearer in the evening.">
        <PriceChart points={history ?? []} band={status.band} />
      </Section>
    </div>
  );
}

function BidTable({ title, bids, myId }: { title: string; bids: AuctionBid[]; myId?: string }) {
  return (
    <div>
      <SubHead>{title}</SubHead>
      {bids.length === 0 ? (
        <div className="empty-state">No bids.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>From</th>
                <th className="num">kWh/30 min</th>
                <th className="num">Limit · TEC/kWh</th>
                <th className="num">Matched · kWh</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id} className={b.participantId === myId ? "row-highlight" : undefined}>
                  <td>
                    <span className="cell-name">{b.participantName}</span>
                    <span className="cell-sub">
                      <TypeBadge type={b.participantType} />
                    </span>
                  </td>
                  <td className="muted">{SOURCE_LABEL[b.source]}</td>
                  <td className="num">{b.quantity.toFixed(2)}</td>
                  <td className="num">{b.limitPrice.toFixed(3)}</td>
                  <td className={"num" + (b.matched > 0 ? (b.side === "sell" ? " supply" : " demand") : " muted")}>{b.matched.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
