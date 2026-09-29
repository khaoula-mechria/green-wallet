import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { api, API_MODE } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { fmtPrice, fmtSimTime } from "../format";
import { TypeBadge } from "./Badge";
import type { MarketStatus } from "../types";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: "📊", end: true },
      { to: "/microgrid", label: "Microgrid", icon: "🌐" },
      { to: "/households", label: "Households", icon: "🏠" },
    ],
  },
  {
    title: "Market",
    items: [
      { to: "/auction", label: "Auction", icon: "⚖️" },
      { to: "/market", label: "Marketplace", icon: "🛒" },
      { to: "/my-offers", label: "My Offers", icon: "📤" },
      { to: "/my-trades", label: "My Trades", icon: "📥" },
    ],
  },
  {
    title: "My home",
    items: [
      { to: "/energy", label: "Energy", icon: "⚡" },
      { to: "/battery", label: "Battery & Settings", icon: "🔋" },
      { to: "/wallet", label: "Wallet", icon: "🪙" },
    ],
  },
  {
    title: "Ledger",
    items: [
      { to: "/transactions", label: "Transactions", icon: "🧾" },
      { to: "/blockchain", label: "Blockchain Explorer", icon: "⛓️" },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { household, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          Green Wallet
        </div>
        <nav>
          {NAV.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          {household && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{household.name}</div>
              <div className="mono" style={{ color: "var(--color-text-muted)", fontSize: 11.5, margin: "2px 0 4px" }}>
                {household.accountId}
              </div>
              <TypeBadge type={household.type} />
            </div>
          )}
          <button className="btn btn-secondary" style={{ width: "100%" }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main-area">
        <MarketTopBar />
        {children}
      </main>
    </div>
  );
}

function MarketTopBar() {
  const { data } = usePolling(() => api.get<MarketStatus>("/market/status"), 1000);
  if (!data) return <div className="topbar" />;
  const seconds = Math.ceil(data.nextSettlementInMs / 1000);
  return (
    <div className="topbar">
      <div className="topbar-item">
        <span className="topbar-label">Simulated time</span>
        <strong>{fmtSimTime(data.simTime)}</strong>
      </div>
      <div className="topbar-item">
        <span className="topbar-label">Last clearing price</span>
        <strong>{fmtPrice(data.lastPrice)} TEC/kWh</strong>
      </div>
      <div className="topbar-item">
        <span className="topbar-label">24h average</span>
        <strong>{fmtPrice(data.avg24h)}</strong>
      </div>
      <div className="topbar-item">
        <span className="topbar-label">Band</span>
        <strong>
          {data.band.floor.toFixed(2)} – {data.band.ceiling.toFixed(2)}
        </strong>
      </div>
      <div className="topbar-item">
        <span className="topbar-label">Next auction</span>
        <strong>{data.paused ? "paused" : `in ${seconds}s`}</strong>
      </div>
      {API_MODE === "mock" && (
        <span className="badge badge-mock" title="All data is simulated in the browser (src/mock) until the backend implements the design.">
          mock data
        </span>
      )}
    </div>
  );
}
