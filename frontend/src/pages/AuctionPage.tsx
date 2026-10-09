import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { useAuth } from "../context/AuthContext";
import { PriceChart } from "../components/PriceChart";
import { MarketNow } from "../components/MarketNow";
import { PageHead, Section } from "../components/ui";
import type { AuctionBid, MarketStatus, MyBidPreview, PricePoint } from "../types";

const SOURCE_LABEL: Record<AuctionBid["source"], string> = {
  surplus: "spare production",
  storage: "stored energy",
  battery: "home battery",
  "grid-pool": "grid pool",
  deficit: "deficit",
};

export function AuctionPage() {
  const { household } = useAuth();
  const { data: status } = usePolling(() => api.get<MarketStatus>("/market/status"), 1000);
  const { data: history } = usePolling(() => api.get<PricePoint[]>("/market/price-history?limit=96"), 2500);
  const { data: myBid } = usePolling(() => api.get<MyBidPreview>("/market/my-bid"), 2500, [household?.id]);

  if (!status) return <div className="empty-state">Opening the market…</div>;

  return (
    <div>
      <PageHead
        kicker="Market"
        title="Prices"
        lede="Every half hour your automatic agent sells the energy you don't need and buys what you're missing, at one price for everyone. Whatever finds no neighbour goes to or comes from the utility."
      />

      <Section title="Market now" note="The last half hour's auction, and what you can buy right now.">
        <MarketNow />
      </Section>

      <Section title="Your agent" note="What it is doing for you this half hour. Change its limits in Battery & Settings.">
        <MyBidCard bid={myBid} />
      </Section>

      <Section title="Price history" note="Low at noon when the sun floods the market; dearer in the evening.">
        <PriceChart points={history ?? []} band={status.band} />
      </Section>
    </div>
  );
}

function MyBidCard({ bid }: { bid: MyBidPreview | null }) {
  if (!bid) return <div className="empty-state">…</div>;
  if (bid.optedOut) {
    return <p className="hint">You opted out of the auction: surplus is exported at the floor and deficits are imported at the ceiling.</p>;
  }
  if (bid.bids.length === 0) {
    return (
      <p className="empty-state">
        {bid.pendingBuyKwh > 0
          ? "You need energy but have no TEC left to buy it with, so it comes from the utility. Top up your wallet to buy from neighbours."
          : "Nothing to trade this half hour: your own production, battery and stored energy covered everything."}
      </p>
    );
  }
  const selling = bid.side === "sell";
  return (
    <div className="agent-lines">
      {bid.bids.map((b, i) => (
        <p key={i} className={"agent-line " + (selling ? "supply" : "demand")}>
          <b>
            {selling ? "▲ Selling" : "▼ Buying"} {b.quantity.toFixed(2)} kWh/30 min
          </b>{" "}
          {selling ? `from your ${SOURCE_LABEL[b.source]}, for no less than` : "for your missing energy, paying at most"} <b>{b.limitPrice.toFixed(3)} TEC/kWh</b>
        </p>
      ))}
      {bid.reservedTec > 0 && (
        <p className="hint">
          <strong>{bid.reservedTec.toFixed(2)} TEC</strong> is set aside until the half hour settles.
        </p>
      )}
    </div>
  );
}
