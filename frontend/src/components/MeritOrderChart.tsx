import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import type { AuctionResult, PriceBand } from "../types";

/** Supply (sellers, cheapest first) and demand (buyers, highest first) step
 * curves; the clearing price sits where they cross (DESIGN §4.2). */
export function MeritOrderChart({ auction, band }: { auction: AuctionResult; band: PriceBand }) {
  const sells = auction.bids.filter((b) => b.side === "sell").sort((a, b) => a.limitPrice - b.limitPrice);
  const buys = auction.bids.filter((b) => b.side === "buy").sort((a, b) => b.limitPrice - a.limitPrice);
  if (sells.length === 0 && buys.length === 0) return <div className="empty-state">No bids in this interval.</div>;

  const curve = (bids: typeof sells) => {
    const pts: Array<{ q: number; p: number }> = [];
    let q = 0;
    for (const b of bids) {
      pts.push({ q, p: b.limitPrice });
      q += b.quantity;
      pts.push({ q, p: b.limitPrice });
    }
    return pts;
  };
  const supply = curve(sells);
  const demand = curve(buys);

  const xs = [...new Set([...supply, ...demand].map((d) => Math.round(d.q * 1000) / 1000))].sort((a, b) => a - b);
  const at = (pts: Array<{ q: number; p: number }>, q: number) => {
    if (pts.length === 0 || q > pts[pts.length - 1].q + 1e-9) return null;
    const hit = pts.find((pt, i) => i % 2 === 1 && q <= pt.q + 1e-9);
    return hit ? hit.p : null;
  };
  const data = xs.map((q) => ({ q, supply: at(supply, q), demand: at(demand, q) }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" />
        <XAxis dataKey="q" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11 }} unit=" kWh" />
        <YAxis domain={[0, Math.ceil((band.ceiling + 0.02) * 100) / 100]} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(3) : "—")} labelFormatter={(q) => `${Number(q).toFixed(2)} kWh`} />
        <Legend />
        {auction.clearingPrice !== null && (
          <ReferenceLine y={auction.clearingPrice} stroke="#16a34a" strokeDasharray="5 3" label={{ value: `clearing ${auction.clearingPrice.toFixed(3)}`, fontSize: 11, position: "insideTopLeft" }} />
        )}
        {auction.volume > 0 && <ReferenceLine x={Math.round(auction.volume * 1000) / 1000} stroke="#5b6b63" strokeDasharray="3 3" />}
        <Line type="stepBefore" dataKey="supply" name="Supply (sellers)" stroke="#16a34a" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line type="stepBefore" dataKey="demand" name="Demand (buyers)" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
