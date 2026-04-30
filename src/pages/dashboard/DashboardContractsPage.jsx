import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api/client";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { formatDateRu, getSafeErrorMessage, money, normalizeApiList, statusBadgeClass } from "./utils";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { FiDollarSign, FiTrendingUp } from "react-icons/fi";

export function DashboardContractsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [miningSummary, setMiningSummary] = useState(null);
  const [stakingSummary, setStakingSummary] = useState(null);
  const [balanceSummary, setBalanceSummary] = useState(null);
  const [miningContracts, setMiningContracts] = useState([]);
  const [stakingPositions, setStakingPositions] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryData, contractsData, stakingSummaryData, stakingPositionsData, balanceData] = await Promise.all([
        apiGet("/api/user/mining/summary"),
        apiGet("/api/user/mining/contracts"),
        apiGet("/api/user/staking/summary"),
        apiGet("/api/user/staking/positions"),
        apiGet("/api/user/balance"),
      ]);
      setMiningSummary(summaryData || null);
      setStakingSummary(stakingSummaryData || null);
      setBalanceSummary(balanceData || null);
      setMiningContracts(normalizeApiList(contractsData));
      setStakingPositions(normalizeApiList(stakingPositionsData));
      setLoaded(true);
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadContracts")));
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

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const mergedContracts = useMemo(() => {
    const miningRows = miningContracts.map((row) => ({
      id: `mining-${row.id}`,
      rawId: row.id,
      sourceType: "mining",
      sourceTypeLabel: t("dashboardCabinet.contracts.typeMining", { defaultValue: "Майнинг" }),
      strategyLabel: row.strategy,
      metricLabel: `${row.hashrateValue} ${row.hashrateUnit}`,
      durationLabel: `${row.durationDays}`,
      remainingDays: Math.max(Math.ceil((new Date(row.endsAt).getTime() - nowMs) / 86400000), 0),
      amountValue: Number(row.investedUsdt || 0),
      status: String(row.status || "").toLowerCase(),
      endsAt: row.endsAt,
    }));
    const stakingRows = stakingPositions.map((row) => ({
      id: `staking-${row.id}`,
      rawId: row.id,
      sourceType: "staking",
      sourceTypeLabel: t("dashboardCabinet.contracts.typeStaking", { defaultValue: "Стейкинг" }),
      strategyLabel: t("dashboardCabinet.contracts.stakingPositionLabel", { defaultValue: "USDT staking position" }),
      metricLabel: `${Number(row.dailyRate || 0).toFixed(4)}%/day`,
      durationLabel: t("dashboardCabinet.staking.defaultTerm", { defaultValue: "30 days (1 month)" }),
      remainingDays: Math.max(Math.ceil((new Date(row.lockUntil).getTime() - nowMs) / 86400000), 0),
      amountValue: Number(row.amount || 0),
      status: String(row.status || "").toLowerCase(),
      endsAt: row.lockUntil,
    }));
    return [...miningRows, ...stakingRows];
  }, [miningContracts, nowMs, stakingPositions, t]);

  const visibleContracts = mergedContracts.filter((row) => {
    if (statusFilter === "all") return true;
    return String(row.status || "").toLowerCase() === statusFilter;
  });

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {loading ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-grid dashboard-grid-2">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.contracts.balanceTitle", { defaultValue: "Баланс" })}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.contracts.balanceHint", { defaultValue: "Доходы и баланс учитываются по всем активным направлениям кабинета." })}</p>
            <div className="dashboard-grid dashboard-grid-2">
              <article className="metric-card is-primary">
                <FiDollarSign className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.contracts.totalBalance", { defaultValue: "Общий баланс" })}</p>
                <h4 className="metric-value">{money(balanceSummary?.balance || 0)}</h4>
              </article>
              <article className="metric-card">
                <FiTrendingUp className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.contracts.miningIncome", { defaultValue: "Доход майнинга" })}</p>
                <h4 className="metric-value">{money(miningSummary?.totalEarnedUsdt || 0)}</h4>
              </article>
              <article className="metric-card">
                <FiTrendingUp className="metric-icon" />
                <p className="metric-label">{t("dashboardCabinet.contracts.stakingIncome", { defaultValue: "Доход стейкинга" })}</p>
                <h4 className="metric-value">{money(stakingSummary?.totalEarnedUsdt || 0)}</h4>
              </article>
            </div>
          </div>
        </div>
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.contracts.listTitle", { defaultValue: "Мои контракты и стейкинги" })}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.contracts.listHint", { defaultValue: "Фильтруйте по статусу, чтобы отслеживать майнинг и стейкинг в одном месте." })}</p>
            <select className="dash-input dash-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">{t("dashboardCabinet.contracts.allStatuses", { defaultValue: "All statuses" })}</option>
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>ID</th><th>{t("dashboardCabinet.contracts.type", { defaultValue: "Тип" })}</th><th>{t("dashboardCabinet.contracts.strategy")}</th><th>{t("dashboardCabinet.contracts.hashrate")}</th><th>{t("dashboardCabinet.contracts.days")}</th><th>{t("dashboardCabinet.contracts.remaining", { defaultValue: "Remaining" })}</th><th>{t("dashboardCabinet.contracts.invested")}</th><th>{t("dashboardCabinet.table.status")}</th><th>{t("dashboardCabinet.contracts.ends")}</th></tr></thead>
                <tbody>
                  {loaded && visibleContracts.length === 0 ? (
                    <tr><td colSpan={9}><EmptyState title={t("dashboardCabinet.empty.noContracts")} actionLabel={t("dashboardCabinet.buyPower.openMarket", { defaultValue: "Open buy screen" })} onAction={() => navigate("/dashboard/buy-power")} /></td></tr>
                  ) : visibleContracts.map((row) => (
                    <tr key={row.id}>
                      <td data-label="ID">{row.rawId}</td>
                      <td data-label={t("dashboardCabinet.contracts.type", { defaultValue: "Тип" })}>{row.sourceTypeLabel}</td>
                      <td data-label={t("dashboardCabinet.contracts.strategy")}>{row.strategyLabel}</td>
                      <td data-label={t("dashboardCabinet.contracts.hashrate")}>{row.metricLabel}</td>
                      <td data-label={t("dashboardCabinet.contracts.days")}>{row.durationLabel}</td>
                      <td data-label={t("dashboardCabinet.contracts.remaining", { defaultValue: "Remaining" })}>{row.remainingDays}d</td>
                      <td data-label={t("dashboardCabinet.contracts.invested")}>{money(row.amountValue)}</td>
                      <td data-label={t("dashboardCabinet.table.status")}><span className={statusBadgeClass(row.status)}>{row.status}</span></td>
                      <td data-label={t("dashboardCabinet.contracts.ends")}>{formatDateRu(row.endsAt)}</td>
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
