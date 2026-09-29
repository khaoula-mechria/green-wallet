import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { TypeBadge } from "../components/Badge";
import { PriceChart } from "../components/PriceChart";
import { MeritOrderChart } from "../components/MeritOrderChart";
import { fmtPrice, fmtSimTime } from "../format";
import type { AuctionBid, AuctionResult, MarketStatus, MyBidPreview, PricePoint } from "../types";

const SOURCE_LABEL: Record<AuctionBid["source"], string> = {
  surplus: "surplus now",
  storage: "stored energy",
  battery: "home battery",
  "grid-pool": "grid pool",
  deficit: "deficit",
};

export function AuctionPage() {
  const { household } = useAuth();
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 1000);
  const { data: auction } = usePolling(() => api.get<AuctionResult | null>("/market/auctions/latest"), 2500);
  const { data: history } = usePolling(() => api.get<PricePoint[]>("/market/price-history?limit=96"), 2500);
  const { data: myBid } = usePolling(() => api.get<MyBidPreview>("/market/my-bid"), 2500, [household?.id]);

  if (!status) return <div className="empty-state">Loading…</div>;

  const sells = (auction?.bids ?? []).filter((b) => b.side === "sell").sort((a, b) => a.limitPrice - b.limitPrice);
  const buys = (auction?.bids ?? []).filter((b) => b.side === "buy").sort((a, b) => b.limitPrice - a.limitPrice);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Auction</h1>
          <p>
            Every {status.intervalMs / 1000} s (30 simulated minutes) all automatic bids clear at one single price — a
            uniform-price double auction.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Last clearing price" value={fmtPrice(auction?.clearingPrice)} sub={auction ? fmtSimTime(auction.simTime) : "no auction yet"} />
        <StatCard label="Volume matched" value={`${(auction?.volume ?? 0).toFixed(2)} kWh`} />
        <StatCard label="Exported to utility" value={`${(auction?.exportedKwh ?? 0).toFixed(2)} kWh`} sub={`at the floor ${status.band.floor.toFixed(2)}`} />
        <StatCard label="Imported from utility" value={`${(auction?.importedKwh ?? 0).toFixed(2)} kWh`} sub={`at the ceiling ${status.band.ceiling.toFixed(2)}`} />
        <StatCard label="Next auction" value={status.paused ? "paused" : `${Math.ceil(status.nextSettlementInMs / 1000)} s`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Supply and demand (last auction)</div>
          {auction ? <MeritOrderChart auction={auction} band={status.band} /> : <div className="empty-state">Waiting for the first auction…</div>}
          <p className="hint">
            Sellers are sorted cheapest first, buyers highest first. Everyone trades at the price halfway between the
            last matched seller and buyer (k = 0.5). A bid is a limit, not the price paid.
          </p>
        </div>
        <div className="card">
          <div className="section-title">Your automatic bid this interval</div>
          <MyBidCard bid={myBid} />
          <div className="section-title" style={{ marginTop: 18 }}>
            Where the floor and ceiling come from
          </div>
          <div className="formula">
            ceiling = wholesale {status.band.components.wholesale.toFixed(2)} + network {status.band.components.networkFee.toFixed(2)} + taxes{" "}
            {status.band.components.taxes.toFixed(2)} + margin {status.band.components.supplierMargin.toFixed(2)} ={" "}
            <strong>{status.band.ceiling.toFixed(2)}</strong>
            <br />
            floor = wholesale {status.band.components.wholesale.toFixed(2)} − balancing {status.band.components.balancingCost.toFixed(2)} ={" "}
            <strong>{status.band.floor.toFixed(2)}</strong>
            <br />
            middle = ({status.band.floor.toFixed(2)} + {status.band.ceiling.toFixed(2)}) / 2 = <strong>{status.band.mid.toFixed(3)}</strong>
          </div>
          <p className="hint">These are the main utility's own prices. The local price always stays between them, so both sides beat the utility.</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <BidTable title="Sellers (cheapest first)" bids={sells} myId={household?.id} />
        <BidTable title="Buyers (highest limit first)" bids={buys} myId={household?.id} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Clearing price history</div>
        <PriceChart points={history ?? []} band={status.band} />
      </div>
    </div>
  );
}

function MyBidCard({ bid }: { bid: MyBidPreview | null }) {
  if (!bid) return <div className="empty-state">Loading…</div>;
  if (bid.optedOut) {
    return <p className="hint">You opted out of the auction: surplus is exported at the floor and deficits are imported at the ceiling.</p>;
  }
  if (bid.bids.length === 0) {
    return (
      <p className="hint">
        No bid this interval — your own battery and stored energy covered everything
        {bid.pendingBuyKwh > 0 ? ", or you have no TEC available to bid" : ""}.
      </p>
    );
  }
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Side</th>
            <th>From</th>
            <th>kWh</th>
            <th>Limit</th>
          </tr>
        </thead>
        <tbody>
          {bid.bids.map((b, i) => (
            <tr key={i}>
              <td className={bid.side === "sell" ? "pos" : "neg"}>{bid.side}</td>
              <td>{SOURCE_LABEL[b.source]}</td>
              <td>{b.quantity.toFixed(3)}</td>
              <td>{b.limitPrice.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bid.reservedTec > 0 && <p className="hint">{bid.reservedTec.toFixed(2)} TEC reserved until this auction settles.</p>}
    </div>
  );
}

function BidTable({ title, bids, myId }: { title: string; bids: AuctionBid[]; myId?: string }) {
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      {bids.length === 0 ? (
        <div className="empty-state">No bids.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>From</th>
                <th>kWh</th>
                <th>Limit</th>
                <th>Matched</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id} className={b.participantId === myId ? "row-highlight" : undefined}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{b.participantName}</div>
                    <TypeBadge type={b.participantType} />
                  </td>
                  <td>{SOURCE_LABEL[b.source]}</td>
                  <td>{b.quantity.toFixed(2)}</td>
                  <td>{b.limitPrice.toFixed(3)}</td>
                  <td className={b.matched > 0 ? "pos" : "muted"}>{b.matched.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
