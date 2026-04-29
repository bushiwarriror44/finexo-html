import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getSafeErrorMessage, money, normalizeApiList, statusBadgeClass } from "./utils";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { FiActivity, FiBarChart2, FiDollarSign, FiTrendingUp } from "react-icons/fi";

export function DashboardContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [miningSummary, setMiningSummary] = useState(null);
  const [miningContracts, setMiningContracts] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryData, contractsData] = await Promise.all([
        apiGet("/api/user/mining/summary"),
        apiGet("/api/user/mining/contracts"),
      ]);
      setMiningSummary(summaryData || null);
      setMiningContracts(normalizeApiList(contractsData));
      setLoaded(true);
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadContracts")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const visibleContracts = miningContracts.filter((row) => {
    if (statusFilter === "all") return true;
    return String(row.status || "").toLowerCase() === statusFilter;
  });

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {loading ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-grid dashboard-grid-2">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.contracts.summaryTitle")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.contracts.summaryHint", { defaultValue: "This summary reflects cumulative contract performance to date." })}</p>
            <div className="dashboard-grid dashboard-grid-5">
              <article className="metric-card is-primary">
                <FiActivity className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.metrics.activeContracts")}</p>
                <h4 className="metric-value">{Number(miningSummary?.activeContracts || 0)}</h4>
              </article>
              <article className="metric-card">
                <FiBarChart2 className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.contracts.activeHashrate")}</p>
                <h4 className="metric-value">{Number(miningSummary?.activeHashrateValue || 0)}</h4>
              </article>
              <article className="metric-card">
                <FiDollarSign className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.contracts.invested")}</p>
                <h4 className="metric-value">{money(miningSummary?.totalInvestedUsdt || 0)}</h4>
              </article>
              <article className="metric-card">
                <FiTrendingUp className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.contracts.earned")}</p>
                <h4 className="metric-value">{money(miningSummary?.totalEarnedUsdt || 0)}</h4>
              </article>
            </div>
            <p className="dash-help"><strong>{t("dashboardCabinet.contracts.roi", { defaultValue: "ROI to date" })}:</strong> {((Number(miningSummary?.totalEarnedUsdt || 0) / Math.max(Number(miningSummary?.totalInvestedUsdt || 0), 1)) * 100).toFixed(2)}%</p>
          </div>
        </div>
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.contracts.listTitle")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.contracts.listHint", { defaultValue: "Filter by status to review lifecycle and expiry dates." })}</p>
            <select className="dash-input dash-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">{t("dashboardCabinet.contracts.allStatuses", { defaultValue: "All statuses" })}</option>
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>ID</th><th>{t("dashboardCabinet.contracts.strategy")}</th><th>{t("dashboardCabinet.contracts.hashrate")}</th><th>{t("dashboardCabinet.contracts.days")}</th><th>{t("dashboardCabinet.contracts.remaining", { defaultValue: "Remaining" })}</th><th>{t("dashboardCabinet.contracts.invested")}</th><th>{t("dashboardCabinet.table.status")}</th><th>{t("dashboardCabinet.contracts.ends")}</th></tr></thead>
                <tbody>
                  {loaded && visibleContracts.length === 0 ? (
                    <tr><td colSpan={8}><EmptyState title={t("dashboardCabinet.empty.noContracts")} actionLabel={t("dashboardCabinet.buyPower.openMarket", { defaultValue: "Open buy screen" })} onAction={() => navigate("/dashboard/buy-power")} /></td></tr>
                  ) : visibleContracts.map((row) => (
                    <tr key={row.id}>
                      <td data-label="ID">{row.id}</td>
                      <td data-label={t("dashboardCabinet.contracts.strategy")}>{row.strategy}</td>
                      <td data-label={t("dashboardCabinet.contracts.hashrate")}>{row.hashrateValue} {row.hashrateUnit}</td>
                      <td data-label={t("dashboardCabinet.contracts.days")}>{row.durationDays}</td>
                      <td data-label={t("dashboardCabinet.contracts.remaining", { defaultValue: "Remaining" })}>{Math.max(Math.ceil((new Date(row.endsAt).getTime() - Date.now()) / 86400000), 0)}d</td>
                      <td data-label={t("dashboardCabinet.contracts.invested")}>{money(row.investedUsdt)}</td>
                      <td data-label={t("dashboardCabinet.table.status")}><span className={statusBadgeClass(row.status)}>{row.status}</span></td>
                      <td data-label={t("dashboardCabinet.contracts.ends")}>{new Date(row.endsAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
