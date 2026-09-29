// Energy profiles per role (DESIGN.md §6.6). Values are kWh per 30-minute interval.

import type { EnergySource, HouseholdType } from "../types";

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
}

function solarShape(hour: number): number {
  if (hour < 6 || hour > 18) return 0;
  return Math.sin((Math.PI * (hour - 6)) / 12);
}

function windShape(hour: number, rand: number): number {
  const v = 0.55 + 0.25 * Math.sin((2 * Math.PI * (hour + 3)) / 24) + (rand - 0.5) * 0.3;
  return Math.min(1, Math.max(0.05, v));
}

/** Household load: a base plus a morning and a larger evening peak. */
function householdLoad(hour: number): number {
  return 0.35 + 0.6 * gauss(hour, 7.5, 1.2) + 1.1 * gauss(hour, 20, 1.8);
}

export interface ProfileParams {
  type: HouseholdType;
  energyType: EnergySource;
  scale: number; // peak production per interval (kWh)
  loadFactor: number; // multiplies the household load curve
}

export function simulateReading(p: ProfileParams, hour: number): { production: number; consumption: number } {
  const noise = () => 0.85 + Math.random() * 0.3;

  let production = 0;
  if (p.type !== "consumer") {
    const shape = p.energyType === "wind" ? windShape(hour, Math.random()) : solarShape(hour) * (0.9 + Math.random() * 0.2);
    production = p.scale * shape;
  }

  // Producers are plants, not homes: their own consumption is treated as 0.
  const consumption = p.type === "producer" ? 0 : householdLoad(hour) * p.loadFactor * noise();

  return { production: Math.max(0, production), consumption: Math.max(0, consumption) };
}
