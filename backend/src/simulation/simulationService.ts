import type { Database } from "better-sqlite3";
import { HouseholdRepository } from "../db/repositories/householdRepository.js";
import type { MeasurementService } from "../services/measurementService.js";
import type { MarketService } from "../services/marketService.js";
import type { ClockService } from "../services/clockService.js";
import { simulateReading } from "./curves.js";

/**
 * Drives the physical-energy layer of the demo: at the start of every market
 * interval it records one meter reading per household from its role's energy
 * profile (solar farm, wind farm, rooftop prosumer, consumer). The market clock
 * (MarketService) owns time and settles each interval; the simulated clock runs
 * much faster than real time, so a full day plays out in a few minutes.
 */
export class SimulationService {
  private readonly households: HouseholdRepository;
  private unsubscribe: (() => void) | null = null;

  constructor(
    db: Database,
    private readonly measurementService: MeasurementService,
    private readonly market: MarketService,
    private readonly clock: ClockService
  ) {
    this.households = new HouseholdRepository(db);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.market.onIntervalStart(() => this.recordReadings());
    console.log("[simulation] started: one simulated reading per household every market interval");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getSimulatedHourOfDay(): number {
    return (this.clock.simTime() % 1440) / 60;
  }

  /** Readings for the current interval, from each household's energy profile. */
  async recordReadings(): Promise<void> {
    const hourOfDay = this.getSimulatedHourOfDay();
    for (const h of this.households.findAll()) {
      const { production, consumption } = simulateReading(h, hourOfDay, Math.random);
      await this.measurementService.record(h.id, production, consumption, "simulation");
    }
  }

  /** One full interval without timers (tests, scripts): settle the current one, then record the next. */
  async runInterval(): Promise<void> {
    this.market.endInterval();
    await this.recordReadings();
  }
}
