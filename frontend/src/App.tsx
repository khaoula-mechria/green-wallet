import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HouseholdsPage } from "./pages/HouseholdsPage";
import { EnergyMonitoringPage } from "./pages/EnergyMonitoringPage";
import { MarketplacePage } from "./pages/MarketplacePage";
import { MyOffersPage } from "./pages/MyOffersPage";
import { MyPurchasesPage } from "./pages/MyPurchasesPage";
import { WalletPage } from "./pages/WalletPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { BlockchainExplorerPage } from "./pages/BlockchainExplorerPage";
import { MicrogridPage } from "./pages/MicrogridPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { household, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!household) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/households" element={<HouseholdsPage />} />
                <Route path="/energy" element={<EnergyMonitoringPage />} />
                <Route path="/market" element={<MarketplacePage />} />
                <Route path="/my-offers" element={<MyOffersPage />} />
                <Route path="/my-purchases" element={<MyPurchasesPage />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/blockchain" element={<BlockchainExplorerPage />} />
                <Route path="/microgrid" element={<MicrogridPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
