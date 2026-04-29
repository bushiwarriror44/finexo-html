import { Navigate, Route, Routes } from "react-router-dom";
import { SiteLayout } from "./components/SiteLayout";
import { RequireAuth } from "./components/RequireAuth";
import {
  AboutPage,
  AboutReadMorePage,
  AmlPolicyPage,
  CookiePolicyPage,
  DashboardPage,
  ForgotPasswordPage,
  HomePage,
  LoginPage,
  PlansPage,
  PrivacyPolicyPage,
  RegisterPage,
  ResetPasswordPage,
  ServiceStrategyPage,
  ServicesPage,
  TeamPage,
  TermsPage,
  WhyUsPage,
} from "./pages";
import { DashboardOverviewPage } from "./pages/dashboard/DashboardOverviewPage";
import { DashboardBalancePage } from "./pages/dashboard/DashboardBalancePage";
import { DashboardTopupsPage } from "./pages/dashboard/DashboardTopupsPage";
import { DashboardContractsPage } from "./pages/dashboard/DashboardContractsPage";
import { DashboardStakingPage } from "./pages/dashboard/DashboardStakingPage";
import { DashboardAccrualsPage } from "./pages/dashboard/DashboardAccrualsPage";
import { DashboardWithdrawalsPage } from "./pages/dashboard/DashboardWithdrawalsPage";
import { DashboardSupportPage } from "./pages/dashboard/DashboardSupportPage";
import { DashboardBuyPowerPage } from "./pages/dashboard/DashboardBuyPowerPage";

export default function App() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/about/cloudmine" element={<AboutReadMorePage />} />
        <Route path="/aml-policy" element={<AmlPolicyPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/:strategyId" element={<ServiceStrategyPage />} />
        <Route path="/why-us" element={<WhyUsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/cookie-policy" element={<CookiePolicyPage />} />
        <Route path="/calculator" element={<Navigate to="/#profitability-calculator" replace />} />
        <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard/overview" replace />} />
          <Route path="overview" element={<DashboardOverviewPage />} />
          <Route path="balance" element={<DashboardBalancePage />} />
          <Route path="topups" element={<DashboardTopupsPage />} />
          <Route path="buy-power" element={<DashboardBuyPowerPage />} />
          <Route path="contracts" element={<DashboardContractsPage />} />
          <Route path="staking" element={<DashboardStakingPage />} />
          <Route path="accruals" element={<DashboardAccrualsPage />} />
          <Route path="withdrawals" element={<DashboardWithdrawalsPage />} />
          <Route path="support" element={<DashboardSupportPage />} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
