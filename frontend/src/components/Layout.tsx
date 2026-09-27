import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { TypeBadge } from "./Badge";

const NAV_ITEMS: Array<{ to: string; label: string; icon: string; end?: boolean }> = [
  { to: "/", label: "Dashboard", icon: "📊", end: true },
  { to: "/households", label: "Households", icon: "🏠" },
  { to: "/energy", label: "Energy Monitoring", icon: "⚡" },
  { to: "/market", label: "Marketplace", icon: "🛒" },
  { to: "/my-offers", label: "My Offers", icon: "📤" },
  { to: "/my-purchases", label: "My Purchases", icon: "📥" },
  { to: "/wallet", label: "Token Wallet", icon: "🪙" },
  { to: "/transactions", label: "Transactions", icon: "🧾" },
  { to: "/blockchain", label: "Blockchain Explorer", icon: "⛓️" },
  { to: "/microgrid", label: "Microgrid", icon: "🌐" },
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
          {NAV_ITEMS.map((item) => (
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
        </nav>
        <div className="sidebar-footer">
          {household && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{household.name}</div>
              <div style={{ marginTop: 4 }}>
                <TypeBadge type={household.type} />
              </div>
            </div>
          )}
          <button className="btn btn-secondary" style={{ width: "100%" }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main-area">{children}</main>
    </div>
  );
}
