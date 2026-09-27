import { createInMemoryDatabase } from "../src/db/database.js";
import { createContainer, type Container } from "../src/container.js";

export function buildTestContainer(): Container {
  const db = createInMemoryDatabase();
  return createContainer(db);
}

export async function seedHousehold(
  c: Container,
  overrides: Partial<{ id: string; name: string; type: "producer" | "consumer" | "prosumer"; password: string; initialTokenBalance: number }> = {}
) {
  const { household } = await c.auth.register({
    id: overrides.id ?? `household-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? "Test Household",
    type: overrides.type ?? "producer",
    location: "Test City",
    password: overrides.password ?? "password123",
    initialTokenBalance: overrides.initialTokenBalance ?? 0,
  });
  return household;
}
