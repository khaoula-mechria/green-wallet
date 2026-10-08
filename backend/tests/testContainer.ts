import { createInMemoryDatabase } from "../src/db/database.js";
import { createContainer, type Container } from "../src/container.js";
import type { SettingsPatch } from "../src/services/householdService.js";

export function buildTestContainer(): Container {
  const db = createInMemoryDatabase();
  return createContainer(db);
}

export async function seedHousehold(
  c: Container,
  overrides: Partial<{
    id: string;
    name: string;
    type: "producer" | "consumer" | "prosumer";
    password: string;
    energyType: "solar" | "wind" | "grid";
    batteryCapacityKwh: number;
    settings: SettingsPatch;
  }> = {}
) {
  const { household } = await c.auth.register({
    id: overrides.id ?? `household-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? "Test Household",
    type: overrides.type ?? "producer",
    location: "Test City",
    password: overrides.password ?? "password123",
    energyType: overrides.energyType,
    batteryCapacityKwh: overrides.batteryCapacityKwh,
    settings: overrides.settings,
  });
  return household;
}

/** A prosumer that owns energy to sell: 10 kWh battery, one reading of 8 produced / 3 used,
 * so 5 kWh in the battery. With the default 20% keep-reserve it can list 3 kWh. */
export async function seedSeller(c: Container, overrides: Parameters<typeof seedHousehold>[1] = {}) {
  const seller = await seedHousehold(c, { type: "prosumer", batteryCapacityKwh: 10, ...overrides });
  await c.measurements.record(seller.id, 8, 3);
  return seller;
}
