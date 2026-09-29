import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { fmtClock } from "../format";
import type { PriceBand, PricePoint } from "../types";

/** Clearing price per interval inside the floor–ceiling band (DESIGN §3–4). */
export function PriceChart({ points, band, height = 260 }: { points: PricePoint[]; band: PriceBand; height?: number }) {
  if (points.length === 0) {
    return <div className="empty-state">No auction has settled yet — the first one clears at the end of this interval.</div>;
  }
  const data = points.map((p) => ({
    time: fmtClock(p.simTime),
    price: p.price,
    avg: p.avg24h,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" />
        <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={24} />
        <YAxis domain={[0, Math.ceil((band.ceiling + 0.02) * 100) / 100]} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(3) : "no match")} />
        <Legend />
        <ReferenceLine y={band.ceiling} stroke="#dc2626" strokeDasharray="6 4" label={{ value: `ceiling ${band.ceiling.toFixed(2)}`, fontSize: 11, position: "insideTopRight" }} />
        <ReferenceLine y={band.floor} stroke="#2563eb" strokeDasharray="6 4" label={{ value: `floor ${band.floor.toFixed(2)}`, fontSize: 11, position: "insideBottomRight" }} />
        <Line type="stepAfter" dataKey="price" name="Clearing price" stroke="#16a34a" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="avg" name="24h average" stroke="#b45309" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
