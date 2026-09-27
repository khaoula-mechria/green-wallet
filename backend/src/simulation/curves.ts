/** Deterministic per-household "personality" (peak capacity, baseline
 * consumption) derived from a hash of the household id, so profiles stay
 * stable across restarts without needing extra schema columns. Combined with
 * a live PRNG for tick-to-tick noise. */
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

export function householdProfile(householdId: string, canProduce: boolean) {
  const seed = hashSeed(householdId);
  const rand = mulberry32(seed);
  const peakCapacityKwh = canProduce ? 4 + rand() * 6 : 0; // 0-10 kWh
  const baseConsumptionKwh = 1.5 + rand() * 3; // 1.5-4.5 kWh
  return { peakCapacityKwh, baseConsumptionKwh };
}

/** Solar-like production curve: ~0 before dawn/after dusk, peak at midday. */
export function solarFactor(hourOfDay: number): number {
  const radians = ((hourOfDay - 6) / 12) * Math.PI;
  return Math.max(0, Math.sin(radians));
}

/** Household consumption curve: baseline + morning and evening peaks. */
export function consumptionFactor(hourOfDay: number): number {
  const morning = Math.exp(-((hourOfDay - 7) ** 2) / 8);
  const evening = Math.exp(-((hourOfDay - 19) ** 2) / 8);
  return 0.4 + 0.3 * morning + 0.3 * evening;
}

export function simulateReading(
  householdId: string,
  canProduce: boolean,
  hourOfDay: number,
  rand: () => number
): { production: number; consumption: number } {
  const { peakCapacityKwh, baseConsumptionKwh } = householdProfile(householdId, canProduce);
  const noise = () => 0.85 + rand() * 0.3;

  const production = canProduce ? Number((peakCapacityKwh * solarFactor(hourOfDay) * noise()).toFixed(2)) : 0;
  const consumption = Number((baseConsumptionKwh * consumptionFactor(hourOfDay) * noise()).toFixed(2));

  return { production, consumption };
}
