import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HouseholdsPage } from "./pages/HouseholdsPage";
import { HouseholdDetailPage } from "./pages/HouseholdDetailPage";
import { EnergyMonitoringPage } from "./pages/EnergyMonitoringPage";
import { MarketplacePage } from "./pages/MarketplacePage";
import { MyOffersPage } from "./pages/MyOffersPage";
import { MyPurchasesPage } from "./pages/MyPurchasesPage";
import { WalletPage } from "./pages/WalletPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { AdminLayout } from "./components/AdminLayout";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { AdminOverviewPage } from "./pages/admin/AdminOverviewPage";
import { AdminHouseholdsPage } from "./pages/admin/AdminHouseholdsPage";
import { AdminAuctionPage } from "./pages/admin/AdminAuctionPage";
import { AdminCertificatesPage } from "./pages/admin/AdminCertificatesPage";
import { BlockchainExplorerPage } from "./pages/BlockchainExplorerPage";
import { AuctionPage } from "./pages/AuctionPage";
import { BatterySettingsPage } from "./pages/BatterySettingsPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { household, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!household) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** The map now lives on the dashboard; keep old links (and ?focus=) working. */
function MicrogridRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/${search}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route
        path="/admin/*"
        element={
          <AdminLayout>
            <Routes>
              <Route index element={<AdminOverviewPage />} />
              <Route path="households" element={<AdminHouseholdsPage />} />
              <Route path="auction" element={<AdminAuctionPage />} />
              <Route path="ledger" element={<TransactionsPage />} />
              <Route path="certificates" element={<AdminCertificatesPage />} />
              <Route path="blocks" element={<BlockchainExplorerPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </AdminLayout>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/households" element={<HouseholdsPage />} />
                <Route path="/households/:id" element={<HouseholdDetailPage />} />
                <Route path="/energy" element={<EnergyMonitoringPage />} />
                <Route path="/auction" element={<AuctionPage />} />
                <Route path="/market" element={<MarketplacePage />} />
                <Route path="/my-offers" element={<MyOffersPage />} />
                <Route path="/my-trades" element={<MyPurchasesPage />} />
                <Route path="/battery" element={<BatterySettingsPage />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/transactions" element={<Navigate to="/admin/ledger" replace />} />
                <Route path="/blockchain" element={<Navigate to="/admin/blocks" replace />} />
                <Route path="/microgrid" element={<MicrogridRedirect />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
