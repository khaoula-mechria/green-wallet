import type { HouseholdType, OfferStatus, TradeStatus } from "../types";

export function TypeBadge({ type }: { type: HouseholdType }) {
  return <span className={`badge badge-${type}`}>{type}</span>;
}

export function StatusBadge({ status }: { status: OfferStatus | TradeStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}
