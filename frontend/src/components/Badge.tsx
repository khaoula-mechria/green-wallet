import type { HouseholdType, LedgerAsset, LedgerTxType, OfferStatus, TradeStatus } from "../types";

export function TypeBadge({ type }: { type: HouseholdType | "operator" }) {
  return <span className={`badge badge-${type}`}>{type}</span>;
}

export function StatusBadge({ status }: { status: OfferStatus | TradeStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

const TX_LABELS: Record<LedgerTxType, string> = {
  OPERATOR_FUNDING: "Operator funding",
  WELCOME_GRANT: "Welcome grant",
  SEED_TOPUP: "Seed top-up",
  TOPUP: "Top-up",
  CASHOUT: "Cash-out",
  AUCTION_PAYMENT: "Auction payment",
  AUCTION_PAYOUT: "Auction payout",
  CLEARING_SWEEP: "Clearing sweep",
  TRADE_SETTLEMENT: "Marketplace trade",
  CERT_ISSUE: "Certificate issued",
  CERT_TRANSFER: "Certificate transfer",
  CERT_RETIRE: "Certificate retired",
  AUCTION_SUMMARY: "Auction record",
};

export function TxTypeBadge({ type, asset }: { type: LedgerTxType; asset: LedgerAsset }) {
  const kind = asset === "TEC" ? "tec" : asset === "RECORD" ? "record" : "cert";
  return <span className={`badge badge-tx-${kind}`}>{TX_LABELS[type]}</span>;
}

export function AssetBadge({ asset }: { asset: LedgerAsset }) {
  return <span className={`badge badge-asset-${asset.toLowerCase()}`}>{asset}</span>;
}
