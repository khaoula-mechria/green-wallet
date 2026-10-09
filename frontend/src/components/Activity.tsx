import { useState } from "react";
import { fmtClock } from "../format";
import type { LedgerTx } from "../types";

/** One movement, in a household's own words. Null: bookkeeping the household doesn't need to see. */
export function describeTx(tx: LedgerTx, accountId: string): { emoji: string; label: string; amount: number; unit: "TEC" | "kWh"; kind: "produced" | "used" | "in" | "out" } | null {
  const incoming = tx.toAccountId === accountId;
  switch (tx.type) {
    case "CERT_ISSUE":
      return incoming ? { emoji: "☀️", label: "Produced", amount: tx.amount, unit: "kWh", kind: "produced" } : null;
    case "CERT_RETIRE":
      return tx.fromAccountId === accountId ? { emoji: "🏠", label: "Green energy used", amount: tx.amount, unit: "kWh", kind: "used" } : null;
    case "AUCTION_PAYOUT":
      return incoming ? { emoji: "⚖️", label: "Sold energy at the auction", amount: tx.amount, unit: "TEC", kind: "in" } : null;
    case "AUCTION_PAYMENT":
      return incoming ? null : { emoji: "⚖️", label: "Bought energy at the auction", amount: tx.amount, unit: "TEC", kind: "out" };
    case "TRADE_SETTLEMENT":
      return incoming
        ? { emoji: "🤝", label: "Sold energy on the marketplace", amount: tx.amount, unit: "TEC", kind: "in" }
        : { emoji: "🤝", label: "Bought energy on the marketplace", amount: tx.amount, unit: "TEC", kind: "out" };
    case "TOPUP":
      return { emoji: "💳", label: "Top-up", amount: tx.amount, unit: "TEC", kind: "in" };
    case "SEED_TOPUP":
      return { emoji: "💳", label: "Starting balance", amount: tx.amount, unit: "TEC", kind: "in" };
    case "WELCOME_GRANT":
      return { emoji: "🎁", label: "Welcome grant", amount: tx.amount, unit: "TEC", kind: "in" };
    case "CASHOUT":
      return { emoji: "💳", label: "Cash-out", amount: tx.amount, unit: "TEC", kind: "out" };
    default:
      return null; // certificate transfers, clearing and operator records: operator console only
  }
}

interface Day {
  day: number;
  produced: number;
  used: number;
  earned: number;
  spent: number;
  items: Array<{ id: string; simTime: number; d: NonNullable<ReturnType<typeof describeTx>> }>;
}

/** Activity summed per simulated day; a day opens to show what happened in it. */
export function ActivityByDay({ txs, accountId, maxDays = 7 }: { txs: LedgerTx[]; accountId: string; maxDays?: number }) {
  const days = new Map<number, Day>();
  for (const tx of txs) {
    const d = describeTx(tx, accountId);
    if (!d) continue;
    const n = Math.floor(tx.simTime / 1440) + 1;
    let day = days.get(n);
    if (!day) days.set(n, (day = { day: n, produced: 0, used: 0, earned: 0, spent: 0, items: [] }));
    if (d.kind === "produced") day.produced += d.amount;
    if (d.kind === "used") day.used += d.amount;
    if (d.kind === "in") day.earned += d.amount;
    if (d.kind === "out") day.spent += d.amount;
    // One line per half hour and kind: ten "green energy used" entries become one.
    const same = day.items.find((it) => it.simTime === tx.simTime && it.d.label === d.label);
    if (same) same.d = { ...same.d, amount: same.d.amount + d.amount };
    else day.items.push({ id: tx.id, simTime: tx.simTime, d: { ...d } });
  }
  const list = [...days.values()].sort((a, b) => b.day - a.day).slice(0, maxDays);
  const [open, setOpen] = useState<number | null>(null);
  const openDay = open ?? list[0]?.day ?? null;

  if (list.length === 0) return <div className="empty-state">No activity yet.</div>;

  return (
    <div className="activity">
      <div className="activity-head" aria-hidden>
        <span>Day</span>
        <span className="num">☀️ Produced</span>
        <span className="num">🏠 Green used</span>
        <span className="num">Earned</span>
        <span className="num">Spent</span>
        <span className="num">Net</span>
        <span />
      </div>
      {list.map((d) => {
        const isOpen = openDay === d.day;
        const net = d.earned - d.spent;
        return (
          <div key={d.day} className={"activity-day" + (isOpen ? " open" : "")}>
            <button className="activity-row" onClick={() => setOpen(isOpen ? -1 : d.day)} aria-expanded={isOpen}>
              <span className="activity-date">Day {d.day}</span>
              <span className="num">{d.produced > 0 ? `${d.produced.toFixed(2)} kWh` : "—"}</span>
              <span className="num">{d.used > 0 ? `${d.used.toFixed(2)} kWh` : "—"}</span>
              <span className="num supply">{d.earned > 0 ? `+${d.earned.toFixed(2)} TEC` : "—"}</span>
              <span className="num demand">{d.spent > 0 ? `−${d.spent.toFixed(2)} TEC` : "—"}</span>
              <span className={"num " + (net > 0 ? "supply" : net < 0 ? "demand" : "muted")}>
                {net === 0 ? "0.00" : `${net > 0 ? "+" : "−"}${Math.abs(net).toFixed(2)}`} TEC
              </span>
              <span className="activity-chevron">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <ul className="activity-items">
                {d.items.map((it) => (
                  <li key={it.id}>
                    <span className="mono muted">{fmtClock(it.simTime)}</span>
                    <span>
                      {it.d.emoji} {it.d.label}
                    </span>
                    <span className={"num " + (it.d.kind === "in" ? "supply" : it.d.kind === "out" ? "demand" : "")}>
                      {it.d.kind === "out" ? "−" : it.d.kind === "in" ? "+" : ""}
                      {it.d.amount.toFixed(it.d.unit === "TEC" ? 2 : 3)} {it.d.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
