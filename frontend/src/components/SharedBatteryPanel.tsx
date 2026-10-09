import { BigBattery, KV } from "./ui";
import { fmtPrice } from "../format";
import type { SharedBatteryStatus } from "../types";

/** The community battery: rented compartment + operator grid pool (DESIGN §6). */
export function SharedBatteryPanel({ status }: { status: SharedBatteryStatus }) {
  return (
    <div>
      <BigBattery
        label="🏡 Rented to households"
        value={status.rented.usedKwh}
        max={status.rented.capacityKwh}
        sub={`${status.rented.households} household${status.rented.households === 1 ? "" : "s"} storing energy here`}
      />
      <BigBattery label="⚙️ Grid pool (operator)" value={status.gridPool.chargeKwh} max={status.gridPool.capacityKwh} sub="Bought cheap, sold in the auction when energy is short" />
      <KV
        rows={[
          ["Total size (level)", `${status.capacityKwh} kWh`],
          ["Most one household can rent (level)", `${status.rented.capPerHouseholdKwh} kWh`],
          ["Storage fee (rate)", `${(status.decayPerHour * 100).toFixed(0)}% of stored kWh per sim. hour`],
          ["Pool buys below (price)", `${fmtPrice(status.gridBuysBelow)} TEC/kWh`],
          ["Pool sells above (price)", `${fmtPrice(status.gridSellsAbove)} TEC/kWh`],
          ["Green energy in pool (level)", `${status.gridPool.greenKwh.toFixed(2)} kWh`],
        ]}
      />
    </div>
  );
}
