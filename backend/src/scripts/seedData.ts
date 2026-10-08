import type { Container } from "../container.js";
import type { SettingsPatch } from "../services/householdService.js";

/** Demo microgrid (docs/DESIGN.md §6.7): 2 producers, 5 prosumers, 4 consumers.
 * Ids match the demo accounts listed on the frontend login page. Prosumers with a
 * battery start half full (grey energy, counted as initial stock); varied price
 * limits make the Phase 3 auction price move.
 * Reused by both `npm run seed` and the server's own boot-time auto-seed. */

interface SeedHousehold {
  id: string;
  name: string;
  type: "producer" | "prosumer" | "consumer";
  location: string;
  energyType: "solar" | "wind" | "grid";
  batteryCapacityKwh?: number;
  settings?: SettingsPatch;
  /** First reading, so certificates and green share are visible before the first tick. */
  production: number;
  consumption: number;
  /** Consumers only: demo money on top of the welcome grant, as a ledger top-up. */
  seedTopupTec?: number;
}

export const SEED_PASSWORD = "password123";

export const SEED_HOUSEHOLDS: SeedHousehold[] = [
  { id: "producer-1", name: "Trabelsi Solar Farm", type: "producer", location: "Sousse, Tunisia", energyType: "solar", settings: { minSellPrice: 0.06 }, production: 12, consumption: 0 },
  { id: "producer-2", name: "Gharbi Wind Farm", type: "producer", location: "Bizerte, Tunisia", energyType: "wind", settings: { minSellPrice: 0.07 }, production: 4, consumption: 0 },
  { id: "prosumer-1", name: "Ben Ali Rooftop Solar", type: "prosumer", location: "Tunis, Tunisia", energyType: "solar", batteryCapacityKwh: 5, settings: { overflowMode: "sell", minSellPrice: 0.08, maxBuyPrice: 0.25 }, production: 2.5, consumption: 0.8 },
  { id: "prosumer-2", name: "Sassi Rooftop Solar", type: "prosumer", location: "Sfax, Tunisia", energyType: "solar", batteryCapacityKwh: 15, settings: { overflowMode: "store", minSellPrice: 0.1, storeMinPrice: 0.18, maxBuyPrice: 0.22, batterySell: { enabled: true, minPrice: 0.24, keepPercent: 40 } }, production: 3, consumption: 1 },
  { id: "prosumer-3", name: "Jomaa Home Solar", type: "prosumer", location: "Nabeul, Tunisia", energyType: "solar", batteryCapacityKwh: 0, settings: { overflowMode: "sell", minSellPrice: 0.05, maxBuyPrice: 0.3 }, production: 2.2, consumption: 0.7 },
  { id: "prosumer-4", name: "Mansour Home Solar", type: "prosumer", location: "Ariana, Tunisia", energyType: "solar", batteryCapacityKwh: 8, settings: { overflowMode: "store", minSellPrice: 0.09, storeMinPrice: 0.2, maxBuyPrice: 0.28 }, production: 2.6, consumption: 0.9 },
  { id: "prosumer-5", name: "Nasri Home Solar", type: "prosumer", location: "Kairouan, Tunisia", energyType: "solar", batteryCapacityKwh: 0, settings: { overflowMode: "sell", minSellPrice: 0.06, maxBuyPrice: 0.3 }, production: 2, consumption: 1.1 },
  { id: "consumer-1", name: "Khelifi Household", type: "consumer", location: "Tunis, Tunisia", energyType: "grid", settings: { maxBuyPrice: 0.3 }, production: 0, consumption: 1.2, seedTopupTec: 40 },
  { id: "consumer-2", name: "Hamdi Household", type: "consumer", location: "La Marsa, Tunisia", energyType: "grid", settings: { maxBuyPrice: 0.25 }, production: 0, consumption: 1, seedTopupTec: 40 },
  { id: "consumer-3", name: "Cherif Household", type: "consumer", location: "Monastir, Tunisia", energyType: "grid", settings: { maxBuyPrice: 0.2 }, production: 0, consumption: 1.4, seedTopupTec: 50 },
  { id: "consumer-4", name: "Bouazizi Household", type: "consumer", location: "Gabes, Tunisia", energyType: "grid", settings: { maxBuyPrice: 0.15 }, production: 0, consumption: 0.9, seedTopupTec: 30 },
];

export async function seedDemoData(c: Container, log: (msg: string) => void = console.log): Promise<void> {
  for (const h of SEED_HOUSEHOLDS) {
    const existing = c.db.prepare(`SELECT id FROM households WHERE id = ?`).get(h.id);
    if (existing) continue;

    await c.auth.register({
      id: h.id,
      name: h.name,
      type: h.type,
      location: h.location,
      password: SEED_PASSWORD,
      energyType: h.energyType,
      batteryCapacityKwh: h.batteryCapacityKwh,
      settings: h.settings,
    });

    if (h.batteryCapacityKwh) c.grid.injectInitialCharge(h.id, h.batteryCapacityKwh / 2);

    if (h.seedTopupTec) {
      const account = c.ledger.getHouseholdAccount(h.id);
      c.ledger.transfer("SEED_TOPUP", null, account.id, h.seedTopupTec, "Seed top-up (demo data)");
    }

    await c.measurements.record(h.id, h.production, h.consumption);

    log(`[seed] created ${h.type} ${h.id} (${h.name})`);
  }
}
