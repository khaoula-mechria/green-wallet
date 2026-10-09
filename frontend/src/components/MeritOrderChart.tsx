import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AuctionResult, PriceBand } from "../types";
import { AXIS_TICK, CHART_MARGIN, COLORS, ChartFrame, ChartTooltip, Key, Legend, niceTicks } from "./ui";

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
  const top = Math.ceil((band.ceiling + 0.02) * 100) / 100;
  const xTicks = niceTicks(xs[xs.length - 1] ?? 1);

  return (
    <figure className="figure">
      <Legend>
        <Key kind="line" color={COLORS.supply}>Supply — sellers, cheapest first</Key>
        <Key kind="line" color={COLORS.demand}>Demand — buyers, most eager first</Key>
      </Legend>
      <ChartFrame y="price limit, TEC per kWh" x="kWh offered or wanted, added up">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke={COLORS.ruleSoft} />
          <XAxis dataKey="q" type="number" domain={[0, xTicks[xTicks.length - 1]]} ticks={xTicks} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.rule }} />
          <YAxis width={40} domain={[0, top]} ticks={[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(2)} />
          <Tooltip
            cursor={{ stroke: COLORS.ink, strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                title={`${Number(label).toFixed(2)} kWh`}
                rows={(payload ?? [])
                  .filter((p) => typeof p.value === "number")
                  .map((p) => ({
                    label: p.dataKey === "supply" ? "Seller asks" : "Buyer offers",
                    value: `${(p.value as number).toFixed(3)}`,
                    color: p.dataKey === "supply" ? COLORS.supply : COLORS.demand,
                  }))}
              />
            )}
          />
          {auction.clearingPrice !== null && (
            <ReferenceLine
              y={auction.clearingPrice}
              stroke={COLORS.ink}
              strokeWidth={1}
              label={{ value: `clears at ${auction.clearingPrice.toFixed(3)}`, fontSize: 11, fill: COLORS.ink, position: "insideTopRight", fontFamily: "Geist Mono, monospace" }}
            />
          )}
          {auction.volume > 0 && <ReferenceLine x={Math.round(auction.volume * 1000) / 1000} stroke={COLORS.ink3} strokeWidth={1} />}
          <Line type="stepBefore" dataKey="supply" stroke={COLORS.supply} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          <Line type="stepBefore" dataKey="demand" stroke={COLORS.demand} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      </ChartFrame>
    </figure>
  );
}
