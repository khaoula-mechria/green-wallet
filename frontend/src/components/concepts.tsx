/**
 * Concept icons: the few energy ideas the product is built on, each with its
 * own colour so it can be recognised at a glance. Everything around them stays
 * neutral — these are the only colourful marks in the interface.
 *
 * solar → yellow / orange · wind → blue · battery → green · grid → blue-grey
 * market → amber · certificate → green · ledger → indigo · home → ink + warm light
 */

type P = { size?: number };

const S = { fill: "none", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const C = {
  solar: "#e08a12",
  solarFill: "#ffd166",
  wind: "#2f7fb5",
  battery: "#24804f",
  batteryFill: "#4cc584",
  grid: "#5a7389",
  market: "#cc6e1e",
  marketFill: "#ffe2c2",
  cert: "#24804f",
  certFill: "#d9f2e3",
  ledger: "#5450c8",
  ledgerFill: "#e5e4fb",
  ink: "#1d2622",
  warm: "#ffc861",
};

export const SolarIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="4.4" fill={C.solarFill} stroke={C.solar} strokeWidth={1.6} />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" stroke={C.solar} {...S} />
  </svg>
);

export const WindIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 10.5v11M9.5 21.5h5" stroke={C.ink} {...S} />
    <path d="M12 10.5 12.6 2.8M12 10.5l6.6 3.6M12 10.5l-6.9 3.1" stroke={C.wind} {...S} strokeWidth={2} />
    <circle cx="12" cy="10.5" r="1.6" fill="#fff" stroke={C.wind} strokeWidth={1.4} />
  </svg>
);

export const BatteryIcon = ({ size = 20, level = 0.7 }: P & { level?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <rect x="2.8" y="7" width="16" height="10" rx="1.6" fill="#fff" stroke={C.battery} strokeWidth={1.6} />
    <rect x="4.6" y="8.8" width={Math.max(0.5, 12.4 * Math.min(1, Math.max(0, level)))} height="6.4" rx="0.6" fill={C.batteryFill} />
    <path d="M21.2 10.3v3.4" stroke={C.battery} {...S} strokeWidth={2} />
  </svg>
);

export const CommunityBatteryIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <rect x="5.5" y="3.8" width="13" height="17.4" rx="1.6" fill="#fff" stroke={C.battery} strokeWidth={1.6} />
    <rect x="7.6" y="12.4" width="8.8" height="2.6" fill={C.batteryFill} />
    <rect x="7.6" y="16.2" width="8.8" height="2.6" fill={C.batteryFill} />
    <rect x="7.6" y="8.6" width="8.8" height="2.6" fill="#e6efe9" />
    <path d="M10 2.4h4" stroke={C.battery} {...S} />
  </svg>
);

export const HomeIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M3.5 11 12 3.8l8.5 7.2" stroke={C.ink} {...S} />
    <path d="M5.8 9.4V20.2h12.4V9.4" stroke={C.ink} {...S} />
    <rect x="10" y="13" width="4" height="4" fill={C.warm} stroke={C.ink} strokeWidth={1.2} />
  </svg>
);

export const GridIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 2.6 7.4 21.4M12 2.6l4.6 18.8M5 7.4h14M6.4 12.4h11.2M8.5 7.4l6.7 5M15.5 7.4l-6.7 5M7.7 12.4 16 19M16.3 12.4 8 19" stroke={C.grid} {...S} strokeWidth={1.4} />
  </svg>
);

export const MarketIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 3.6v16.8M7.4 20.4h9.2M4.6 7h14.8" stroke={C.ink} {...S} />
    <path d="M4.6 7 2.4 12.8a2.3 2.3 0 0 0 4.4 0z" fill={C.marketFill} stroke={C.market} strokeWidth={1.5} strokeLinejoin="round" />
    <path d="M19.4 7l-2.2 5.8a2.3 2.3 0 0 0 4.4 0z" fill={C.marketFill} stroke={C.market} strokeWidth={1.5} strokeLinejoin="round" />
  </svg>
);

export const CertificateIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M8.6 14.6 7 21.4l5-2.6 5 2.6-1.6-6.8" fill={C.certFill} stroke={C.cert} strokeWidth={1.5} strokeLinejoin="round" />
    <circle cx="12" cy="9.4" r="6.2" fill="#fff" stroke={C.cert} strokeWidth={1.6} />
    <path d="M9.4 9.6l1.8 1.8 3.6-3.6" stroke={C.cert} {...S} />
  </svg>
);

export const LedgerIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <rect x="3" y="4" width="7.5" height="7.5" fill={C.ledgerFill} stroke={C.ledger} strokeWidth={1.5} />
    <rect x="13.5" y="12.5" width="7.5" height="7.5" fill={C.ledgerFill} stroke={C.ledger} strokeWidth={1.5} />
    <path d="M10.5 7.8h3.2v4.7" stroke={C.ledger} {...S} strokeWidth={1.5} />
  </svg>
);

export const NetworkIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 12 5 6M12 12l7-6M12 12l-6 7M12 12l7 6.5" stroke={C.ink} {...S} strokeWidth={1.3} />
    <circle cx="5" cy="6" r="2" fill="#fff" stroke={C.ink} strokeWidth={1.4} />
    <circle cx="19" cy="6" r="2" fill="#fff" stroke={C.ink} strokeWidth={1.4} />
    <circle cx="6" cy="19" r="2" fill="#fff" stroke={C.ink} strokeWidth={1.4} />
    <circle cx="19" cy="18.5" r="2" fill="#fff" stroke={C.ink} strokeWidth={1.4} />
    <circle cx="12" cy="12" r="3" fill={C.batteryFill} stroke={C.battery} strokeWidth={1.5} />
  </svg>
);

export const EnergyIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M13.2 2.6 4.6 13.6h6.6l-1 7.8 8.6-11.2h-6.6z" fill={C.solarFill} stroke={C.solar} strokeWidth={1.5} strokeLinejoin="round" />
  </svg>
);

export const WalletIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M4 7.6A2.4 2.4 0 0 1 6.4 5.2H18v2.8" stroke={C.ink} {...S} />
    <rect x="3.4" y="8" width="17.2" height="12" rx="1.8" fill="#fff" stroke={C.ink} strokeWidth={1.6} />
    <rect x="14.4" y="12" width="6.2" height="4" fill={C.certFill} stroke={C.cert} strokeWidth={1.3} />
  </svg>
);

export const PeopleIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <circle cx="9" cy="8.4" r="3.2" fill="#fff" stroke={C.ink} strokeWidth={1.6} />
    <path d="M3 19.6c.4-3.3 2.8-5.6 6-5.6s5.6 2.3 6 5.6" stroke={C.ink} {...S} />
    <circle cx="17" cy="9.4" r="2.4" fill={C.warm} stroke={C.ink} strokeWidth={1.4} />
    <path d="M16.6 14.2c2.4.3 4 2 4.4 4.8" stroke={C.ink} {...S} />
  </svg>
);

export const OfferIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M3.6 12.2V4.6a1 1 0 0 1 1-1h7.6l8.2 8.2a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z" fill={C.marketFill} stroke={C.market} strokeWidth={1.5} strokeLinejoin="round" />
    <circle cx="8" cy="8" r="1.5" fill="#fff" stroke={C.market} strokeWidth={1.4} />
  </svg>
);

export const TradeIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M7 3.6 3.6 7 7 10.4M3.6 7h12.8" stroke={C.battery} {...S} />
    <path d="M17 13.6l3.4 3.4-3.4 3.4M20.4 17H7.6" stroke={C.market} {...S} />
  </svg>
);

export const BlocksIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 3 19.5 7.2v9.6L12 21l-7.5-4.2V7.2z" fill={C.ledgerFill} stroke={C.ledger} strokeWidth={1.5} strokeLinejoin="round" />
    <path d="M4.5 7.2 12 11.5l7.5-4.3M12 11.5V21" stroke={C.ledger} {...S} strokeWidth={1.4} />
  </svg>
);

/** The icon for a participant's role and source. */
export function RoleIcon({ type, energyType, size = 20 }: { type: string; energyType?: string; size?: number }) {
  if (type === "producer") return energyType === "wind" ? <WindIcon size={size} /> : <SolarIcon size={size} />;
  if (type === "operator") return <GridIcon size={size} />;
  return <HomeIcon size={size} />;
}

export const CommandIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <rect x="3.5" y="3.5" width="7.5" height="7.5" fill="#fff" stroke={C.ink} strokeWidth={1.5} />
    <rect x="13" y="3.5" width="7.5" height="7.5" fill={C.batteryFill} stroke={C.battery} strokeWidth={1.5} />
    <rect x="3.5" y="13" width="7.5" height="7.5" fill="#fff" stroke={C.ink} strokeWidth={1.5} />
    <rect x="13" y="13" width="7.5" height="7.5" fill="#fff" stroke={C.ink} strokeWidth={1.5} />
  </svg>
);

export const StoreIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M3.8 9.4 5.4 4h13.2l1.6 5.4z" fill={C.marketFill} stroke={C.market} strokeWidth={1.5} strokeLinejoin="round" />
    <path d="M5.4 9.6V20h13.2V9.6M10 20v-4.6h4V20" stroke={C.ink} {...S} />
  </svg>
);
