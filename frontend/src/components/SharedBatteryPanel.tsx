import { Gauge } from "./Gauge";
import { fmtPrice } from "../format";
import type { SharedBatteryStatus } from "../types";

/** The community battery: rented compartment + operator grid pool (DESIGN §6). */
export function SharedBatteryPanel({ status }: { status: SharedBatteryStatus }) {
  return (
    <div>
      <Gauge
        label={`Rented space (${status.rented.households} households)`}
        value={status.rented.usedKwh}
        max={status.rented.capacityKwh}
        color="var(--color-accent)"
      />
      <Gauge label="Grid pool (operator)" value={status.gridPool.chargeKwh} max={status.gridPool.capacityKwh} color="var(--color-blue)" />
      <div className="kv-list">
        <div>
          <span>Total capacity</span>
          <strong>{status.capacityKwh} kWh</strong>
        </div>
        <div>
          <span>Cap per household</span>
          <strong>{status.rented.capPerHouseholdKwh} kWh</strong>
        </div>
        <div>
          <span>Storage fee (decay)</span>
          <strong>{(status.decayPerHour * 100).toFixed(0)}% / simulated hour</strong>
        </div>
        <div>
          <span>Grid pool buys below</span>
          <strong>{fmtPrice(status.gridBuysBelow)} TEC/kWh</strong>
        </div>
        <div>
          <span>Grid pool sells above</span>
          <strong>{fmtPrice(status.gridSellsAbove)} TEC/kWh</strong>
        </div>
        <div>
          <span>Green energy in grid pool</span>
          <strong>{status.gridPool.greenKwh.toFixed(2)} kWh</strong>
        </div>
      </div>
    </div>
  );
}
