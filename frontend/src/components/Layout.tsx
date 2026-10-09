import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { API_MODE } from "../api/client";
import { Brand } from "./brand";
import { IconLogout } from "./icons";
import {
  BatteryIcon,
  EnergyIcon,
  MarketIcon,
  NetworkIcon,
  OfferIcon,
  PeopleIcon,
  StoreIcon,
  TradeIcon,
  WalletIcon,
} from "./concepts";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/** The product is drawn as one system: the grid, the market on it, your home, and the ledger underneath. */
export const NAV: Array<{ code: string; title: string; items: NavItem[] }> = [
  {
    code: "01",
    title: "Grid",
    items: [
      { to: "/", label: "My microgrid", icon: <NetworkIcon size={16} />, end: true },
      { to: "/households", label: "Households", icon: <PeopleIcon size={16} /> },
    ],
  },
  {
    code: "02",
    title: "Market",
    items: [
      { to: "/auction", label: "Prices", icon: <MarketIcon size={16} /> },
      { to: "/market", label: "Marketplace", icon: <StoreIcon size={16} /> },
      { to: "/my-offers", label: "My Offers", icon: <OfferIcon size={16} /> },
      { to: "/my-trades", label: "My Trades", icon: <TradeIcon size={16} /> },
    ],
  },
  {
    code: "03",
    title: "My home",
    items: [
      { to: "/energy", label: "Energy", icon: <EnergyIcon size={16} /> },
      { to: "/battery", label: "Battery & Settings", icon: <BatteryIcon size={16} /> },
      { to: "/wallet", label: "Wallet", icon: <WalletIcon size={16} /> },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { household, logout } = useAuth();

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand dark />

        {/* A single-line diagram: one bus, a junction per layer, a tap per page. */}
        <nav className="side-nav" aria-label="Sections">
          {NAV.map((group) => (
            <div key={group.title} className="side-group">
              <div className="side-group-title">
                <span className="bus-node" aria-hidden />
                <span className="side-code">{group.code}</span>
                {group.title}
              </div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          {API_MODE === "mock" && (
            <div className="side-net">
              <span className="side-net-dot" />
              <span>Demo data, simulated in your browser</span>
            </div>
          )}
          {household && (
            <div className="side-user">
              <span className="avatar" aria-hidden>
                {household.name.charAt(0)}
              </span>
              <span className="side-user-text">
                <strong title={household.name}>{household.name}</strong>
                <span>{household.type}</span>
              </span>
              <button className="icon-button" onClick={logout} title="Log out">
                <IconLogout size={17} />
                <span className="sr-only">Log out</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="app-main">
        <main className="main-area">{children}</main>
        <footer className="colophon">
          <span>Green Wallet · local energy market, batteries, auctions and green certificates</span>
          <span>{API_MODE === "mock" ? "Data simulated in the browser" : "Simulated microgrid"}</span>
        </footer>
      </div>
    </div>
  );
}
