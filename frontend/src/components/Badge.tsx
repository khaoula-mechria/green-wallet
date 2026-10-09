import type { HouseholdType, LedgerAsset, LedgerTxType, OfferStatus, TradeStatus } from "../types";

/** Role as a small chip: deep green producer, green prosumer, amber consumer, grey operator. */
export function TypeBadge({ type }: { type: HouseholdType | "operator" }) {
  return (
    <span className={`role role-${type}`}>
      <span className="role-dot" aria-hidden />
      {type}
    </span>
  );
}

export function StatusBadge({ status }: { status: OfferStatus | TradeStatus }) {
  return <span className={`tag tag-${status}`}>{status}</span>;
}

export const TX_LABELS: Record<LedgerTxType, string> = {
  OPERATOR_FUNDING: "🏦 Operator funding",
  WELCOME_GRANT: "🎁 Welcome grant",
  SEED_TOPUP: "💳 Starting balance",
  TOPUP: "💳 Top-up",
  CASHOUT: "💳 Cash-out",
  AUCTION_PAYMENT: "⚖️ Paid for energy (auction)",
  AUCTION_PAYOUT: "⚖️ Paid for energy sold (auction)",
  CLEARING_SWEEP: "⚖️ Clearing sweep",
  TRADE_SETTLEMENT: "🤝 Marketplace trade",
  CERT_ISSUE: "🌿 Green kWh certified",
  CERT_TRANSFER: "🌿 Certificate passed on",
  CERT_RETIRE: "🌿 Green kWh used",
  AUCTION_SUMMARY: "🧾 Auction record",
};

export function TxTypeBadge({ type }: { type: LedgerTxType; asset?: LedgerAsset }) {
  return <span>{TX_LABELS[type]}</span>;
}

export function AssetBadge({ asset }: { asset: LedgerAsset }) {
  return <span className={`tag tag-${asset.toLowerCase()}`}>{asset}</span>;
}
