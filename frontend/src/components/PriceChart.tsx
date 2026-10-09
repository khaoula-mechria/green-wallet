import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtClock } from "../format";
import type { PriceBand, PricePoint } from "../types";
import { AXIS_TICK, CHART_MARGIN, COLORS, ChartFrame, ChartTooltip, Key, Legend } from "./ui";

/** Clearing price per interval inside the utility's floor–ceiling band (DESIGN §3–4). */
export function PriceChart({ points, band, height = 260 }: { points: PricePoint[]; band: PriceBand; height?: number }) {
  if (points.length === 0) {
    return <div className="empty-state">No auction has settled yet — the first one clears at the end of this interval.</div>;
  }
  const data = points.map((p) => ({ time: fmtClock(p.simTime), price: p.price, avg: p.avg24h }));
  const top = Math.ceil((band.ceiling + 0.02) * 100) / 100;

  return (
    <figure className="figure">
      <Legend>
        <Key kind="line" color={COLORS.supply}>Clearing price</Key>
        <Key kind="line" color={COLORS.ink3}>24 h average</Key>
        <Key kind="band">Utility band {band.floor.toFixed(2)}–{band.ceiling.toFixed(2)}</Key>
      </Legend>
      <ChartFrame y="TEC per kWh" x="time of day (simulated)">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <ReferenceArea y1={band.floor} y2={band.ceiling} fill={COLORS.paperSunk} fillOpacity={0.3} stroke="none" />
          <CartesianGrid stroke={COLORS.ruleSoft} />
          <XAxis dataKey="time" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.rule }} minTickGap={36} />
          <YAxis width={40} domain={[0, top]} ticks={[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(2)} />
          <ReferenceLine y={band.ceiling} stroke={COLORS.ink3} strokeDasharray="4 3" label={{ value: "utility sells (ceiling)", position: "insideTopRight", fontSize: 10.5, fill: COLORS.ink3 }} />
          <ReferenceLine y={band.floor} stroke={COLORS.ink3} strokeDasharray="4 3" label={{ value: "utility buys (floor)", position: "insideBottomRight", fontSize: 10.5, fill: COLORS.ink3 }} />
          <Tooltip
            cursor={{ stroke: COLORS.ink, strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                title={label}
                rows={(payload ?? []).map((p) => ({
                  label: p.dataKey === "price" ? "Clearing" : "24 h avg",
                  value: typeof p.value === "number" ? `${p.value.toFixed(3)} TEC/kWh` : "no match",
                  color: p.dataKey === "price" ? COLORS.supply : COLORS.ink3,
                }))}
              />
            )}
          />
          <Line type="monotone" dataKey="avg" stroke={COLORS.ink3} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="price" stroke={COLORS.supply} strokeWidth={2} strokeLinejoin="round" dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      </ChartFrame>
    </figure>
  );
}
