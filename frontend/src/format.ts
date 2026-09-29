export const fmtKwh = (n: number, digits = 2) => `${n.toFixed(digits)} kWh`;
export const fmtTec = (n: number) => `${n.toFixed(2)} TEC`;
export const fmtPrice = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(3));
export const fmtMoney = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;

/** Simulated time is minutes since day 1, 00:00. */
export function fmtSimTime(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1;
  const m = minutes % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `Day ${day} · ${hh}:${mm}`;
}

export function fmtClock(minutes: number): string {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function shortId(id: string, keep = 14): string {
  return id.length > keep ? `${id.slice(0, keep)}…` : id;
}
