import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../api/client";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getSafeErrorMessage, money, normalizeApiList, statusBadgeClass } from "./utils";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { MiniTrendChart } from "../../components/dashboard/MiniTrendChart";
import { FiBarChart2, FiCalendar, FiTrendingUp } from "react-icons/fi";

export function DashboardAccrualsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [miningAccruals, setMiningAccruals] = useState([]);
  const [contractFilter, setContractFilter] = useState("all");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet("/api/user/mining/accruals");
      setMiningAccruals(normalizeApiList(data));
      setLoaded(true);
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadAccruals")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const visibleAccruals = miningAccruals.filter((row) => {
    if (contractFilter === "all") return true;
    return String(row.contractId) === contractFilter;
  });
  const dayNet = visibleAccruals.slice(0, 1).reduce((sum, item) => sum + Number(item.netUsdt || 0), 0);
  const weekNet = visibleAccruals.slice(0, 7).reduce((sum, item) => sum + Number(item.netUsdt || 0), 0);
  const monthNet = visibleAccruals.slice(0, 30).reduce((sum, item) => sum + Number(item.netUsdt || 0), 0);
  const contracts = Array.from(new Set(miningAccruals.map((item) => String(item.contractId)).filter(Boolean)));
  const trend30 = visibleAccruals.slice(0, 30).reverse();

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {loading ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.accruals.title")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.accruals.hint", { defaultValue: "Compare 1D, 7D, and 30D net results to evaluate trend stability." })}</p>
            <div className="dashboard-grid dashboard-grid-5">
              <article className="metric-card is-primary"><FiCalendar className="metric-icon" /><p className="metric-label">1D</p><h4 className="metric-value">{money(dayNet)}</h4></article>
              <article className="metric-card"><FiBarChart2 className="metric-icon" /><p className="metric-label">7D</p><h4 className="metric-value">{money(weekNet)}</h4></article>
              <article className="metric-card"><FiTrendingUp className="metric-icon" /><p className="metric-label">30D</p><h4 className="metric-value">{money(monthNet)}</h4></article>
            </div>
            <div className="metric-card is-muted">
              <p className="metric-label">{t("dashboardCabinet.charts.accrualTrend", { defaultValue: "Accrual trend (30 points)" })}</p>
              <MiniTrendChart
                labels={trend30.map((item) => item.accrualAt || item.accrualDate || "")}
                values={trend30.map((item) => Number(item.netUsdt || 0))}
                color="#17a77b"
              />
            </div>
            <select className="dash-input dash-select-sm" value={contractFilter} onChange={(e) => setContractFilter(e.target.value)}>
              <option value="all">{t("dashboardCabinet.accruals.allContracts", { defaultValue: "All contracts" })}</option>
              {contracts.map((id) => <option key={id} value={id}>#{id}</option>)}
            </select>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>{t("dashboardCabinet.table.date")}</th><th>{t("dashboardCabinet.accruals.contract")}</th><th>{t("dashboardCabinet.accruals.gross")}</th><th>{t("dashboardCabinet.accruals.net")}</th><th>{t("dashboardCabinet.table.status")}</th></tr></thead>
                <tbody>
                  {loaded && visibleAccruals.length === 0 ? (
                    <tr><td colSpan={5}><EmptyState title={t("dashboardCabinet.empty.noAccruals")} actionLabel={t("dashboardCabinet.buyPower.openMarket", { defaultValue: "Open buy screen" })} onAction={() => navigate("/dashboard/buy-power")} /></td></tr>
                  ) : visibleAccruals.slice(0, 200).map((row) => (
                    <tr key={row.id}>
                      <td data-label={t("dashboardCabinet.table.date")}>{row.accrualAt ? new Date(row.accrualAt).toLocaleString() : row.accrualDate}</td>
                      <td data-label={t("dashboardCabinet.accruals.contract")}>{row.contractId}</td>
                      <td data-label={t("dashboardCabinet.accruals.gross")}>{money(row.grossUsdt)}</td>
                      <td data-label={t("dashboardCabinet.accruals.net")}>{money(row.netUsdt)}</td>
                      <td data-label={t("dashboardCabinet.table.status")}><span className={statusBadgeClass(row.status)}>{row.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dash-muted">{t("dashboardCabinet.accruals.note")}</p>
          </div>
        </div>
      </div>
    </>
  );
}
