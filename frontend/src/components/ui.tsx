import type { CSSProperties, ReactNode } from "react";
import { StatusCluster } from "./StatusCluster";

/** Page opening: a quiet eyebrow, a serif title, a short lede, and the live market status on the right. */
export function PageHead({ kicker, title, lede }: { kicker: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <div className="page-kicker">{kicker.replace(/^\d+\s*·\s*/, "")}</div>
        <h1>{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      <StatusCluster />
    </header>
  );
}

/** A card with its title and a one-line explanation on top. */
/**
 * One emoji per idea, so every part of the product is recognisable at a glance.
 * The same idea always gets the same emoji, wherever it appears.
 */
export const SECTION_EMOJI: Record<string, string> = {
  "Energy neighbourhood": "🗺️",
  "Market now": "⚖️",
  "Your activity": "🗓️",
  "Green energy": "🌿",
  "Money and ledger": "💰",
  "Price band": "📐",
  Register: "🗂️",
  "Add a household": "➕",
  "Credit TEC": "💳",
  "Live map": "🗺️",
  "The last auction": "⚖️",
  "Last auction": "⚖️",
  "Supply meets demand": "⚖️",
  "The order book": "📒",
  "Your agent": "🤖",
  "Agent instructions": "🤖",
  "Price history": "📈",
  "Price today": "📈",
  "My storage": "🔋",
  Storage: "🔋",
  "The shared battery": "🔋",
  "Community battery": "🔋",
  "Production and use": "☀️",
  "Energy now": "☀️",
  "Energy history": "☀️",
  "Submit a reading": "📝",
  "Where each kWh went": "🔀",
  "List energy you own": "🏪",
  "Producers sell at auction": "🏪",
  "Open offers": "🏪",
  "In the market": "🏪",
  "Recent trades": "🤝",
  Open: "🏷️",
  Closed: "🗂️",
  Bought: "📥",
  Sold: "📤",
  Balance: "💳",
  "Your wallet": "💳",
  "Green certificates": "🌿",
  "Utility statement": "🔌",
  Ledger: "🧾",
  "Your ledger": "🧾",
  "The feed": "🧾",
  "Certificates & ledger": "🧾",
  "System integrity": "🛡️",
  Network: "🌐",
  Chain: "⛓️",
  "Block record": "🧱",
  Producers: "🏭",
  Prosumers: "🏡",
  Consumers: "🏠",
};

export function Emoji({ children }: { children: string }) {
  return (
    <span className="emoji" aria-hidden>
      {children}
    </span>
  );
}

export function Section({
  title,
  note,
  children,
  className,
}: {
  num?: string;
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"section" + (className ? ` ${className}` : "")}>
      <header className="section-label">
        <h2>
          {typeof title === "string" && SECTION_EMOJI[title] && <Emoji>{SECTION_EMOJI[title]}</Emoji>}
          {title}
        </h2>
        {note && <p>{note}</p>}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="sub-head">{children}</h3>;
}

export function Readouts({ children }: { children: ReactNode }) {
  return <div className="readouts">{children}</div>;
}

/** A figure with a small-caps label: the number is the thing. */
export function Readout({
  label,
  value,
  unit,
  sub,
  hero,
  tone,
  icon,
  iconTone,
}: {
  icon?: ReactNode;
  iconTone?: "sun" | "leaf" | "amber" | "sky";
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  hero?: boolean;
  tone?: "supply" | "demand";
}) {
  return (
    <div className={"readout" + (hero ? " hero" : "") + (icon ? " with-icon" : "")}>
      {icon && <span className={"readout-icon" + (iconTone ? ` ${iconTone}` : "")}>{icon}</span>}
      <div className="readout-label">{label}</div>
      <div className={"readout-value" + (tone ? ` ${tone}` : "")}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="readout-sub">{sub}</div>}
    </div>
  );
}

/** Battery-style charge indicator: N rounded cells, the last one partly filled. */
export function Cells({
  value,
  max,
  label,
  tone = "ink",
  count,
  compact,
}: {
  value: number;
  max: number;
  label?: ReactNode;
  tone?: "ink" | "leaf" | "sky";
  count?: number;
  compact?: boolean;
}) {
  const n = count ?? (compact ? 10 : 20);
  const filled = max > 0 ? Math.min(1, Math.max(0, value / max)) * n : 0;
  return (
    <div className={compact ? undefined : "cells-wrap"} title={`${value.toFixed(2)} / ${max} kWh`}>
      {label !== undefined && (
        <div className="cells-head">
          <span>{label}</span>
          <span className="num">
            {value.toFixed(2)} <span className="muted">/ {max.toFixed(0)} kWh</span>
            {max > 0 && <b className="cells-pct">{Math.round((value / max) * 100)}%</b>}
          </span>
        </div>
      )}
      <div className={`cells ${tone === "ink" ? "" : tone}${compact ? " compact" : ""}`}>
        {Array.from({ length: n }, (_, i) => {
          const fill = Math.min(1, Math.max(0, filled - i));
          if (fill >= 1) return <span key={i} className="cell on" />;
          if (fill > 0) return <span key={i} className="cell partial" style={{ "--fill": `${fill * 100}%` } as CSSProperties} />;
          return <span key={i} className="cell" />;
        })}
      </div>
      {!compact && (
        <div className="cells-scale" aria-hidden>
          <span>0</span>
          <span>50%</span>
          <span>{max.toFixed(0)} kWh</span>
        </div>
      )}
    </div>
  );
}

export function KV({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Key({ kind, color, children }: { kind: "line" | "dot" | "band"; color?: string; children: ReactNode }) {
  return (
    <span className="key">
      <span className={`key-${kind}`} style={color ? { background: color } : undefined} />
      {children}
    </span>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="legend">{children}</div>;
}

/** Shared dark tooltip for every chart (recharts `content` prop). */
export function ChartTooltip({
  active,
  title,
  rows,
}: {
  active?: boolean;
  title?: ReactNode;
  rows: Array<{ label: string; value: string; color?: string }>;
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="chart-tooltip">
      {title && <div className="tt-title">{title}</div>}
      {rows.map((r) => (
        <div key={r.label} className="tt-row">
          <span>
            {r.color && <span className="tt-key" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export const COLORS = {
  ink: "#1f2a24",
  ink3: "#7b8279",
  rule: "#dcd8cc",
  ruleSoft: "#ebe8df",
  paper: "#fcfbf7",
  paperSunk: "#e9eddf",
  /** Local supply, production, selling. */
  supply: "#3B9A65",
  /** Demand, consumption, buying. */
  demand: "#CC6E1E",
  /** The utility grid: import and export. */
  grid: "#2F7FB5",
  sun: "#D3A021",
  wind: "#2F7FB5",
  grey: "#b9b6ab",
};

export const AXIS_TICK = { fontSize: 11.5, fill: "#39433f", fontFamily: "Geist Mono, monospace" };

/** Chart margins that leave room for readable axis values. */
export const CHART_MARGIN = { top: 8, right: 20, bottom: 2, left: 4 };

/** Round-number ticks from 0 to just above `max`: 0, 0.5, 1, 1.5… or 0, 5, 10… */
export function niceTicks(max: number, count = 5): number[] {
  const raw = Math.max(max, 1e-6) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks.length > 1 ? ticks : [0, step];
}

/** Every chart says what its axes measure: the vertical unit above, the horizontal unit below. */
export function ChartFrame({ y, x, children }: { y: string; x: string; children: ReactNode }) {
  return (
    <div className="chart-frame">
      <div className="axis-y">↑ {y}</div>
      {children}
      <div className="axis-x">{x} →</div>
    </div>
  );
}

/** A battery you can read from across the room: how full it is, and how much that is. */
export function BigBattery({ label, value, max, sub, warnLow = false }: { label: ReactNode; value: number; max: number; sub?: ReactNode; warnLow?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  // Only a battery you rely on warns when low; a mostly empty shared space is not a problem.
  const tone = !warnLow ? "ok" : pct < 10 ? "empty" : pct < 25 ? "low" : "ok";
  return (
    <figure className="bigbat" aria-label={`${typeof label === "string" ? label : "Battery"}: ${pct.toFixed(0)}% full, ${value.toFixed(2)} of ${max} kWh`}>
      <figcaption className="bigbat-head">
        <span className="bigbat-label">{label}</span>
        <span className="bigbat-amount">
          <b>{value.toFixed(2)}</b> of {max.toFixed(0)} kWh stored
        </span>
      </figcaption>
      <div className="bigbat-shell">
        <div className="bigbat-body">
          <div className={`bigbat-fill ${tone}`} style={{ width: `${pct}%` }} />
          <span className="bigbat-mark" style={{ left: "25%" }} />
          <span className="bigbat-mark" style={{ left: "50%" }} />
          <span className="bigbat-mark" style={{ left: "75%" }} />
          <span className="bigbat-pct">
            {pct.toFixed(0)}
            <small>% full</small>
          </span>
        </div>
        <div className="bigbat-cap" />
      </div>
      <div className="bigbat-scale" aria-hidden>
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
      {sub && <div className="bigbat-sub">{sub}</div>}
    </figure>
  );
}

/** A small battery for tables: fill, percentage and kWh. */
export function MiniBattery({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span className="minibat" title={`${value.toFixed(2)} of ${max} kWh stored`}>
      <span className="minibat-body">
        <span className={"minibat-fill" + (pct < 20 ? " low" : "")} style={{ width: `calc(${pct}% - 2px)` }} />
      </span>
      <span className="minibat-cap" />
      <span className="minibat-text">
        {pct.toFixed(0)}% <small>· {value.toFixed(1)}/{max} kWh</small>
      </span>
    </span>
  );
}
