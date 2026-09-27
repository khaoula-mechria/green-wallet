import type { Container } from "../container.js";

/** 5 producer + 5 consumer households with realistic sample data, per the
 * functional spec's example (Producer 1: 8kWh produced / 3kWh consumed /
 * 5kWh surplus; Consumer 1: 0 produced / 4kWh consumed / 4kWh deficit).
 * Reused by both `npm run seed` and the server's own boot-time auto-seed. */

interface SeedHousehold {
  id: string;
  name: string;
  type: "producer" | "consumer";
  location: string;
  energyType: string;
  production: number;
  consumption: number;
  initialTokenBalance: number;
}

export const SEED_PASSWORD = "password123";

export const SEED_PRODUCERS: SeedHousehold[] = [
  { id: "producer-1", name: "Ben Ali Rooftop Solar", type: "producer", location: "Tunis, Tunisia", energyType: "solar", production: 8, consumption: 3, initialTokenBalance: 0 },
  { id: "producer-2", name: "Trabelsi Solar Farm", type: "producer", location: "Sousse, Tunisia", energyType: "solar", production: 10, consumption: 2, initialTokenBalance: 0 },
  { id: "producer-3", name: "Gharbi Wind Turbine", type: "producer", location: "Bizerte, Tunisia", energyType: "wind", production: 7, consumption: 2.5, initialTokenBalance: 0 },
  { id: "producer-4", name: "Sassi Rooftop Solar", type: "producer", location: "Sfax, Tunisia", energyType: "solar", production: 9, consumption: 3.5, initialTokenBalance: 0 },
  { id: "producer-5", name: "Jomaa Community Solar", type: "producer", location: "Nabeul, Tunisia", energyType: "solar", production: 6.5, consumption: 2, initialTokenBalance: 0 },
];

export const SEED_CONSUMERS: SeedHousehold[] = [
  { id: "consumer-1", name: "Khelifi Household", type: "consumer", location: "Tunis, Tunisia", energyType: "grid", production: 0, consumption: 4, initialTokenBalance: 50 },
  { id: "consumer-2", name: "Mansour Household", type: "consumer", location: "Ariana, Tunisia", energyType: "grid", production: 0, consumption: 3.2, initialTokenBalance: 50 },
  { id: "consumer-3", name: "Hamdi Household", type: "consumer", location: "La Marsa, Tunisia", energyType: "grid", production: 0, consumption: 5, initialTokenBalance: 60 },
  { id: "consumer-4", name: "Cherif Household", type: "consumer", location: "Monastir, Tunisia", energyType: "grid", production: 0, consumption: 2.8, initialTokenBalance: 40 },
  { id: "consumer-5", name: "Nasri Household", type: "consumer", location: "Kairouan, Tunisia", energyType: "grid", production: 0, consumption: 3.7, initialTokenBalance: 45 },
];

export async function seedDemoData(c: Container, log: (msg: string) => void = console.log): Promise<void> {
  for (const h of [...SEED_PRODUCERS, ...SEED_CONSUMERS]) {
    const existing = c.db.prepare(`SELECT id FROM households WHERE id = ?`).get(h.id);
    if (existing) continue;

    await c.auth.register({
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      password: SEED_PASSWORD,
      energyType: h.energyType,
      initialTokenBalance: h.initialTokenBalance,
    });

    // Seed an initial measurement so surplus is tokenized and visible immediately,
    // without waiting for the first simulation tick.
    await c.measurements.record(h.id, h.production, h.consumption);

    log(`[seed] created ${h.type} ${h.id} (${h.name})`);
  }
}
