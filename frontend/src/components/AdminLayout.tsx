import { NavLink, Navigate, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { clearOperatorToken, getOperatorToken } from "../api/client";
import { Mark } from "./brand";
import { IconLogout } from "./icons";
import { BlocksIcon, CertificateIcon, CommandIcon, LedgerIcon, MarketIcon, PeopleIcon } from "./concepts";

const NAV = [
  {
    code: "01",
    title: "System",
    items: [
      { to: "/admin", label: "Overview", icon: <CommandIcon size={16} />, end: true },
      { to: "/admin/households", label: "Households", icon: <PeopleIcon size={16} /> },
      { to: "/admin/auction", label: "Auction book", icon: <MarketIcon size={16} /> },
    ],
  },
  {
    code: "02",
    title: "Ledger",
    items: [
      { to: "/admin/ledger", label: "Transactions", icon: <LedgerIcon size={16} /> },
      { to: "/admin/certificates", label: "Certificates", icon: <CertificateIcon size={16} /> },
      { to: "/admin/blocks", label: "Blocks", icon: <BlocksIcon size={16} /> },
    ],
  },
];

/** The operator console: every technical view the households don't need. */
export function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  if (!getOperatorToken()) return <Navigate to="/admin/login" replace />;

  return (
    <div className="app admin">
      <aside className="sidebar">
        <span className="brand brand-dark">
          <Mark size={30} />
          <span className="brand-text">
            <strong>Green Wallet</strong>
            <small>operator console</small>
          </span>
        </span>
        <nav className="side-nav" aria-label="Console">
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
          <div className="side-net">
            <span className="side-net-dot" />
            <span>
              Simulated Hedera ledger
              <small>operator account 0.0.1000</small>
            </span>
          </div>
          <div className="side-user">
            <span className="avatar" aria-hidden>
              ⚙
            </span>
            <span className="side-user-text">
              <strong>Operator</strong>
              <span>system administrator</span>
            </span>
            <button
              className="icon-button"
              title="Log out"
              onClick={() => {
                clearOperatorToken();
                navigate("/admin/login");
              }}
            >
              <IconLogout size={17} />
              <span className="sr-only">Log out</span>
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
