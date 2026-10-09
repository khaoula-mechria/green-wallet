import type { ReactNode } from "react";

/**
 * Every figure in Green Wallet is one of two things:
 *  - a RATE: something flowing or priced per unit — kWh per half hour, TEC per kWh;
 *  - a LEVEL: an amount at a moment — kWh stored, TEC held, a share in %.
 * The unit always says which, so "1.33" is never ambiguous.
 */
export const UNIT = {
  /** Energy flowing during one half-hour market interval. */
  flow: "kWh/30 min",
  /** An amount of energy: stored, listed, or added up. */
  energy: "kWh",
  /** A price. */
  price: "TEC/kWh",
  /** Money. */
  money: "TEC",
  pct: "%",
} as const;

export type UnitKind = keyof typeof UNIT;

const RATE: Record<UnitKind, boolean> = { flow: true, energy: false, price: true, money: false, pct: false };

/** A value with its unit; rates show their "per" part in a quieter tone. */
export function Q({ v, kind, digits, sign = false }: { v: number | null | undefined; kind: UnitKind; digits?: number; sign?: boolean }) {
  if (v === null || v === undefined || Number.isNaN(v)) return <span className="q">—</span>;
  const d = digits ?? (kind === "price" ? 3 : kind === "pct" ? 0 : 2);
  const text = (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  return (
    <span className="q">
      {text}
      <QUnit kind={kind} />
    </span>
  );
}

export function QUnit({ kind }: { kind: UnitKind }) {
  const u = UNIT[kind];
  if (!RATE[kind]) return <span className="q-unit">{u}</span>;
  const [a, b] = u.split("/");
  return (
    <span className="q-unit">
      {a}
      <span className="q-per">/{b}</span>
    </span>
  );
}

/** "rate" or "level", next to a figure's label. */
export function KindTag({ kind }: { kind: "rate" | "level" | "share" }) {
  return <span className={`kind-tag kind-${kind}`}>{kind}</span>;
}

/** The units, explained once. */
export function UnitsKey({ children }: { children?: ReactNode }) {
  return (
    <div className="units-key">
      <span>
        <KindTag kind="rate" /> <b>kWh/30 min</b> energy flowing in one half hour · <b>TEC/kWh</b> a price
      </span>
      <span>
        <KindTag kind="level" /> <b>kWh</b> energy stored or added up · <b>TEC</b> money held
      </span>
      {children}
    </div>
  );
}
