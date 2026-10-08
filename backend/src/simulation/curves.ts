import type { HouseholdType } from "../domain/types.js";

/**
 * Energy profiles per role (docs/DESIGN.md §6.6), in kWh per 30-minute interval.
 * Mirrors frontend/src/mock/profiles.ts so the mock and the backend behave alike.
 *
 * Each household gets a stable "personality" (peak output, load factor) derived
 * from a hash of its id, so profiles survive restarts without extra columns; a
 * live PRNG adds tick-to-tick noise.
 */
export interface ProfileSubject {
  id: string;
  type: HouseholdType;
  energyType: string;
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

// mulberry32 PRNG
function mulberry32(seed: number) {
  let a = seed * 0xffffffff;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Peak production per interval and consumption multiplier, by role. */
export function householdProfile(h: ProfileSubject): { peakKwh: number; loadFactor: number } {
  const rand = mulberry32(hashSeed(h.id));
  const a = rand();
  const b = rand();
  switch (h.type) {
    case "producer":
      // A solar farm floods the noon market; a wind farm is smaller but runs at night.
      return { peakKwh: h.energyType === "wind" ? 4 + a * 2 : 20 + a * 5, loadFactor: 0 };
    case "prosumer":
      return { peakKwh: 2.5 + a, loadFactor: 0.9 + b * 0.4 };
    default:
      return { peakKwh: 0, loadFactor: 0.9 + b * 0.5 };
  }
}

/** Solar curve: 0 before 06:00 and after 18:00, peak at noon. */
export function solarFactor(hourOfDay: number): number {
  if (hourOfDay < 6 || hourOfDay > 18) return 0;
  return Math.sin((Math.PI * (hourOfDay - 6)) / 12);
}

/** Wind: steadier than solar, a little stronger at night, with gusts. */
export function windFactor(hourOfDay: number, gust: number): number {
  const v = 0.55 + 0.25 * Math.sin((2 * Math.PI * (hourOfDay + 3)) / 24) + (gust - 0.5) * 0.3;
  return Math.min(1, Math.max(0.05, v));
}

/** Household load (kWh per interval): a base plus a morning and a larger evening peak. */
export function householdLoad(hourOfDay: number): number {
  const gauss = (mu: number, sigma: number) => Math.exp(-((hourOfDay - mu) ** 2) / (2 * sigma ** 2));
  return 0.35 + 0.6 * gauss(7.5, 1.2) + 1.1 * gauss(20, 1.8);
}

export function simulateReading(
  h: ProfileSubject,
  hourOfDay: number,
  rand: () => number
): { production: number; consumption: number } {
  const { peakKwh, loadFactor } = householdProfile(h);
  const noise = () => 0.85 + rand() * 0.3;

  let production = 0;
  if (h.type !== "consumer") {
    const shape = h.energyType === "wind" ? windFactor(hourOfDay, rand()) : solarFactor(hourOfDay) * (0.9 + rand() * 0.2);
    production = peakKwh * shape;
  }
  // Producers are plants, not homes: their own consumption is treated as 0.
  const consumption = h.type === "producer" ? 0 : householdLoad(hourOfDay) * loadFactor * noise();

  return { production: round2(production), consumption: round2(consumption) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
