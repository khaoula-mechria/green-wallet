import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { MeasurementService } from "../services/measurementService.js";
import { simulateReading } from "./curves.js";
import { env } from "../config/env.js";

/**
 * Drives the physical-energy layer of the demo: on each tick, generates a
 * new meter reading (production/consumption) per household following a
 * solar-like production curve and an independent consumption curve, then
 * feeds it through MeasurementService (which derives surplus/deficit and
 * auto-tokenizes any surplus). A simulated clock runs much faster than real
 * time so a full day cycle — and therefore a demonstrable marketplace — plays
 * out in minutes.
 */
export class SimulationService {
  private readonly households: HouseholdRepository;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;
  private simulatedClockMs: number;

  constructor(db: Database, private readonly measurementService: MeasurementService) {
    this.households = new HouseholdRepository(db);
    // Start at 06:00 simulated time so producers ramp up quickly after boot.
    this.simulatedClockMs = 6 * 60 * 60 * 1000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), env.simulationTickMs);
    console.log(
      `[simulation] started: tick every ${env.simulationTickMs}ms, +${env.simulationMinutesPerTick} simulated minutes per tick`
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSimulatedHourOfDay(): number {
    return (this.simulatedClockMs / 3_600_000) % 24;
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) return; // avoid overlapping ticks if one runs long
    this.tickInFlight = true;
    try {
      this.simulatedClockMs += env.simulationMinutesPerTick * 60_000;
      const hourOfDay = this.getSimulatedHourOfDay();
      const households = this.households.findAll();

      for (const h of households) {
        const canProduce = h.type === "producer" || h.type === "prosumer";
        const rand = Math.random;
        const { production, consumption } = simulateReading(h.id, canProduce, hourOfDay, rand);
        await this.measurementService.record(h.id, production, consumption);
      }
    } catch (err) {
      console.error("[simulation] tick failed:", (err as Error).message);
    } finally {
      this.tickInFlight = false;
    }
  }
}
