import { ValidationError } from "../utils/errors.js";

/**
 * Fixed-point units. Every balance and amount is stored and computed as an
 * integer; decimal kWh / TEC only exist at the API boundary.
 *
 *   energy: Wh    (1 kWh = 1_000 Wh)          — 0.001 kWh precision
 *   money:  µTEC  (1 TEC = 1_000_000 µTEC)    — 0.000001 TEC precision
 *   price:  µTEC per kWh
 *
 * Minting is 1 kWh -> 1 TEC, i.e. 1 Wh -> 1_000 µTEC, which is exact.
 */
export const WH_PER_KWH = 1_000;
export const MICRO_PER_TEC = 1_000_000;
export const MICRO_PER_WH_MINTED = MICRO_PER_TEC / WH_PER_KWH;

function toUnits(value: number, scale: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  const units = Math.round(value * scale);
  if (!Number.isSafeInteger(units)) throw new ValidationError(`${field} is out of range`);
  return units;
}

export const kwhToWh = (kwh: number, field = "amountKwh"): number => toUnits(kwh, WH_PER_KWH, field);
export const whToKwh = (wh: number): number => wh / WH_PER_KWH;
export const tecToMicro = (tec: number, field = "amount"): number => toUnits(tec, MICRO_PER_TEC, field);
export const microToTec = (micro: number): number => micro / MICRO_PER_TEC;

/** µTEC to pay for `amountWh` at `priceMicroPerKwh`, rounded half-up to the
 * nearest µTEC. BigInt keeps the intermediate product exact. */
export function tradeTotalMicro(priceMicroPerKwh: number, amountWh: number): number {
  const product = BigInt(priceMicroPerKwh) * BigInt(amountWh);
  const total = (product + BigInt(WH_PER_KWH / 2)) / BigInt(WH_PER_KWH);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new ValidationError("trade total is out of range");
  return Number(total);
}
