import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { MeasurementService } from "../services/measurementService.js";
import type { MarketService } from "../services/marketService.js";
import type { ClockService } from "../services/clockService.js";
import { simulateReading } from "./curves.js";
import { env } from "../config/env.js";

/**
 * Drives the physical-energy layer of the demo. Every tick closes the current
 * market interval (storage decay, offer expiry — and the auction in Phase 3),
 * then generates one meter reading per household from its role's energy profile
 * and feeds it through MeasurementService. The simulated clock runs much faster
 * than real time (SIMULATION_MINUTES_PER_TICK per tick), so a full day plays out
 * in a few minutes.
 */
export class SimulationService {
  private readonly households: HouseholdRepository;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;

  constructor(
    db: Database,
    private readonly measurementService: MeasurementService,
    private readonly market: MarketService,
    private readonly clock: ClockService
  ) {
    this.households = new HouseholdRepository(db);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), env.simulationTickMs);
    this.market.setRunning(true);
    console.log(
      `[simulation] started: tick every ${env.simulationTickMs}ms, +${env.simulationMinutesPerTick} simulated minutes per tick`
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.market.setRunning(false);
  }

  getSimulatedHourOfDay(): number {
    return (this.clock.simTime() % 1440) / 60;
  }

  /** One interval: close the current one, then record everyone's readings for the next. */
  async runInterval(): Promise<void> {
    this.market.endInterval();
    const hourOfDay = this.getSimulatedHourOfDay();
    for (const h of this.households.findAll()) {
      const { production, consumption } = simulateReading(h, hourOfDay, Math.random);
      await this.measurementService.record(h.id, production, consumption, "simulation");
    }
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) return; // avoid overlapping ticks if one runs long
    this.tickInFlight = true;
    try {
      await this.runInterval();
    } catch (err) {
      console.error("[simulation] tick failed:", (err as Error).message);
    } finally {
      this.tickInFlight = false;
    }
  }
}
