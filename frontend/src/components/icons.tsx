import type { ReactNode } from "react";

/** Line icons drawn for Green Wallet: 24px grid, 1.6 stroke, round joins. */
function Icon({ children, size = 20, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const IconHome = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9v11h13V9" />
    <path d="M10 20v-5.5h4V20" />
  </Icon>
);
export const IconNetwork = (p: P) => (
  <Icon {...p}>
    <circle cx="5.5" cy="6" r="2" />
    <circle cx="18.5" cy="6" r="2" />
    <circle cx="12" cy="18" r="2.2" />
    <path d="M7.5 6h9M6.6 7.8l4.3 8.4M17.4 7.8l-4.3 8.4" />
  </Icon>
);
export const IconUsers = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19.5c.4-3.3 2.8-5.5 6-5.5s5.6 2.2 6 5.5" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M16.5 14.2c2.4.3 4 2 4.5 4.8" />
  </Icon>
);
export const IconScale = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5v16.5M7.5 20h9M5 7h14" />
    <path d="M5 7 2.5 13a2.6 2.6 0 0 0 5 0z" />
    <path d="M19 7l-2.5 6a2.6 2.6 0 0 0 5 0z" />
  </Icon>
);
export const IconStore = (p: P) => (
  <Icon {...p}>
    <path d="M4 9.5 5.5 4h13L20 9.5" />
    <path d="M4 9.5c0 1.5 1.2 2.5 2.7 2.5s2.6-1 2.6-2.5c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.1 2.5 2.6 2.5S20 11 20 9.5" />
    <path d="M5.5 12v8h13v-8M10 20v-4.5h4V20" />
  </Icon>
);
export const IconTag = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.3 6.3a1.4 1.4 0 0 1-2 0z" />
    <circle cx="8" cy="8" r="1.5" />
  </Icon>
);
export const IconSwap = (p: P) => (
  <Icon {...p}>
    <path d="M7 3.5 3.5 7 7 10.5M3.5 7h13" />
    <path d="M17 13.5l3.5 3.5-3.5 3.5M20.5 17h-13" />
  </Icon>
);
export const IconBolt = (p: P) => (
  <Icon {...p}>
    <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" />
  </Icon>
);
export const IconBattery = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="7" width="15.5" height="10" rx="2" />
    <path d="M21 10.5v3M6.5 10v4M9.5 10v4" />
  </Icon>
);
export const IconBatteryTall = (p: P) => (
  <Icon {...p}>
    <rect x="6.5" y="4" width="11" height="17" rx="2" />
    <path d="M10 2.5h4M9.5 16.5h5M9.5 13h5M9.5 9.5h5" />
  </Icon>
);
export const IconWallet = (p: P) => (
  <Icon {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
    <rect x="3.5" y="8" width="17" height="12" rx="2.5" />
    <circle cx="16.3" cy="14" r="1.2" />
  </Icon>
);
export const IconList = (p: P) => (
  <Icon {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.8" cy="6.5" r="1" />
    <circle cx="4.8" cy="12" r="1" />
    <circle cx="4.8" cy="17.5" r="1" />
  </Icon>
);
export const IconBlocks = (p: P) => (
  <Icon {...p}>
    <path d="M12 3 19.5 7.2v9.6L12 21l-7.5-4.2V7.2z" />
    <path d="M4.5 7.2 12 11.5l7.5-4.3M12 11.5V21" />
  </Icon>
);
export const IconSun = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
  </Icon>
);
export const IconMoon = (p: P) => (
  <Icon {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
  </Icon>
);
export const IconPylon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.5 7 21.5M12 2.5l5 19M5 7.5h14M6.5 12.5h11" />
    <path d="M8.3 7.5l7.2 5M15.7 7.5l-7.2 5M7.6 12.5l8.4 7M16.4 12.5l-8.4 7" />
  </Icon>
);
export const IconBars = (p: P) => (
  <Icon {...p}>
    <path d="M5 20v-5M10 20V9.5M15 20v-7M20 20V5" />
  </Icon>
);
export const IconLeaf = (p: P) => (
  <Icon {...p}>
    <path d="M5 19.5C5 10.5 10.5 4.5 20 4.5c0 9.5-6 15-14.5 15" />
    <path d="M5 19.5c2.8-4.2 6-7.2 10-9.2" />
  </Icon>
);
export const IconLogout = (p: P) => (
  <Icon {...p}>
    <path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5" />
    <path d="M10 16.5 14.5 12 10 7.5M14.5 12H4" />
  </Icon>
);
export const IconArrowUp = (p: P) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const IconArrowDown = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const IconArrowRight = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const IconWind = (p: P) => (
  <Icon {...p}>
    <path d="M3 8.5h10.5a3 3 0 1 0-3-3" />
    <path d="M3 12.5h15a3 3 0 1 1-3 3" />
    <path d="M3 16.5h6.5" />
  </Icon>
);
export const IconCheck = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
