import { Link } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Readout, Readouts } from "./ui";
import { fmtPrice } from "../format";
import type { AuctionResult, EnergyOffer } from "../types";

/** How much energy is on sale, how much is wanted, and how much you can buy right now. */
export function MarketNow() {
  const { data: auction } = usePolling(() => api.get<AuctionResult | null>("/market/auctions/latest"), 2500);
  const { data: offers } = usePolling(() => api.get<EnergyOffer[]>("/market/offers"), 2500);

  const bids = auction?.bids ?? [];
  const sells = bids.filter((b) => b.side === "sell");
  const buys = bids.filter((b) => b.side === "buy");
  const offered = sells.reduce((s, b) => s + b.quantity, 0);
  const wanted = buys.reduce((s, b) => s + b.quantity, 0);
  const sellers = new Set(sells.map((b) => b.participantId)).size;
  const buyers = new Set(buys.map((b) => b.participantId)).size;

  const open = (offers ?? []).filter((o) => o.status === "active");
  const forSale = open.reduce((s, o) => s + o.amountRemainingKwh, 0);
  const cheapest = open.length ? Math.min(...open.map((o) => o.pricePerKwh)) : null;

  return (
    <div className="market-now">
      <Readouts>
        <Readout
          label="Price · rate"
          value={auction?.clearingPrice == null ? "—" : fmtPrice(auction.clearingPrice)}
          unit="TEC/kWh"
          sub={auction?.clearingPrice == null ? "no local trade last half hour" : "one price for everyone"}
        />
        <Readout label="For sale · rate" value={offered.toFixed(2)} unit="kWh/30 min" sub={`by ${sellers} seller${sellers === 1 ? "" : "s"}`} tone="supply" />
        <Readout label="Wanted · rate" value={wanted.toFixed(2)} unit="kWh/30 min" sub={`by ${buyers} buyer${buyers === 1 ? "" : "s"}`} tone="demand" />
        <Readout label="Traded · rate" value={(auction?.volume ?? 0).toFixed(2)} unit="kWh/30 min" sub="between neighbours" />
      </Readouts>
      <div className="market-now-grid">
        <span>
          🔌 From the utility <b>{(auction?.importedKwh ?? 0).toFixed(2)} kWh/30 min</b> · to the utility <b>{(auction?.exportedKwh ?? 0).toFixed(2)} kWh/30 min</b>
        </span>
      </div>
      <Link className="market-now-offers" to="/market">
        <span className="market-now-emoji">🏪</span>
        <span>
          {open.length === 0 ? (
            <>No energy listed on the marketplace right now</>
          ) : (
            <>
              <b>{forSale.toFixed(2)} kWh</b> available to buy now · {open.length} offer{open.length === 1 ? "" : "s"}, from <b>{fmtPrice(cheapest)} TEC/kWh</b>
            </>
          )}
        </span>
        <span className="card-link">Marketplace →</span>
      </Link>
    </div>
  );
}
