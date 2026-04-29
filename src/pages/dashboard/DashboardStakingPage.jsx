import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../api/client";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { getSafeErrorMessage, money } from "./utils";
import { FiClock, FiDollarSign, FiTrendingUp } from "react-icons/fi";

export function DashboardStakingPage() {
  const { t } = useTranslation();
  const [tiers, setTiers] = useState([]);
  const [positions, setPositions] = useState([]);
  const [summary, setSummary] = useState({ totalInvestedUsdt: 0, totalEarnedUsdt: 0, activePositions: 0 });
  const [amountByTier, setAmountByTier] = useState({});
  const [loading, setLoading] = useState(false);
  const [submittingTierId, setSubmittingTierId] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [tiersData, positionsData, summaryData] = await Promise.all([
        apiGet("/api/user/staking/tiers"),
        apiGet("/api/user/staking/positions"),
        apiGet("/api/user/staking/summary"),
      ]);
      setTiers(Array.isArray(tiersData) ? tiersData : []);
      setPositions(Array.isArray(positionsData) ? positionsData : []);
      setSummary(summaryData || { totalInvestedUsdt: 0, totalEarnedUsdt: 0, activePositions: 0 });
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadStaking", { defaultValue: "Failed to load staking data." })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
    const interval = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(""), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  const hourlyYield = useMemo(() => {
    return positions.reduce((acc, position) => acc + Number(position.amount || 0) * Number(position.hourlyRate || 0), 0);
  }, [positions]);

  const invest = async (tier) => {
    const value = Number(amountByTier[tier.id] || 0);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t("dashboardCabinet.staking.invalidAmount", { defaultValue: "Enter a valid amount." }));
      return;
    }
    setSubmittingTierId(tier.id);
    setError("");
    try {
      await apiPost("/api/user/staking/invest", { amount: value });
      setStatus(t("dashboardCabinet.staking.investSuccess", { defaultValue: "Investment opened successfully." }));
      await load();
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.staking.investFailed", { defaultValue: "Failed to open staking position." })));
    } finally {
      setSubmittingTierId(null);
    }
  };

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-panel">
        <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.staking.title", { defaultValue: "USDT Staking" })}</h5></div>
        <div className="dashboard-panel-body">
          <p className="dash-help">{t("dashboardCabinet.staking.autoCreditHint", { defaultValue: "Staking profit is accrued hourly and automatically credited to your main balance for normal withdrawal flow." })}</p>
          <div className="dashboard-grid dashboard-grid-5">
            <article className="metric-card is-primary">
              <FiDollarSign className="metric-icon" />
              <p className="metric-label">{t("dashboardCabinet.staking.totalInvested", { defaultValue: "Total Invested" })}</p>
              <h4 className="metric-value">{money(summary.totalInvestedUsdt || 0)}</h4>
            </article>
            <article className="metric-card">
              <FiTrendingUp className="metric-icon" />
              <p className="metric-label">{t("dashboardCabinet.staking.totalEarned", { defaultValue: "Total Earned" })}</p>
              <h4 className="metric-value">{money(summary.totalEarnedUsdt || 0)}</h4>
            </article>
            <article className="metric-card">
              <FiClock className="metric-icon" />
              <p className="metric-label">{t("dashboardCabinet.staking.hourlyYield", { defaultValue: "Hourly Yield" })}</p>
              <h4 className="metric-value">{money(hourlyYield || 0)}</h4>
            </article>
          </div>
        </div>
      </div>
      <div className="dashboard-grid dashboard-grid-2">
        {tiers.map((tier) => (
          <article className="dashboard-panel staking-tier-card" key={tier.id}>
            <div className="dashboard-panel-body">
              <div className="staking-tier-head">
                <img src="/images/crypto/usdt-circle.svg" alt="USDT" />
                {tier.isHotOffer ? <span className="dash-badge is-warning">{t("dashboardCabinet.staking.hotOffer", { defaultValue: "Hot offer" })}</span> : null}
              </div>
              <h5>{Number(tier.minAmount).toLocaleString()} - {Number(tier.maxAmount).toLocaleString()} USDT</h5>
              <p>{(Number(tier.dailyRate) * 100).toFixed(1)}% / {t("dashboardCabinet.staking.day", { defaultValue: "day" })}</p>
              <input
                className="dash-input"
                type="number"
                min={tier.minAmount}
                max={tier.maxAmount}
                step="0.01"
                placeholder={t("dashboardCabinet.staking.amountPlaceholder", { defaultValue: "Amount in USDT" })}
                value={amountByTier[tier.id] || ""}
                onChange={(e) => setAmountByTier((prev) => ({ ...prev, [tier.id]: e.target.value }))}
              />
              <button className="dash-btn is-primary" type="button" disabled={submittingTierId === tier.id} onClick={() => invest(tier)}>
                {submittingTierId === tier.id ? t("dashboardCabinet.actions.submitting", { defaultValue: "Submitting..." }) : t("dashboardCabinet.staking.invest", { defaultValue: "Invest" })}
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-panel">
        <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.staking.positionsTitle", { defaultValue: "Active staking positions" })}</h5></div>
        <div className="dashboard-panel-body">
          <div className="table-shell">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t("dashboardCabinet.table.amount")}</th>
                  <th>{t("dashboardCabinet.staking.dailyRate", { defaultValue: "Daily rate" })}</th>
                  <th>{t("dashboardCabinet.staking.earned", { defaultValue: "Earned" })}</th>
                  <th>{t("dashboardCabinet.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr><td colSpan={5}><EmptyState title={t("dashboardCabinet.empty.noStakingPositions", { defaultValue: "No staking positions yet" })} /></td></tr>
                ) : positions.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{money(row.amount)}</td>
                    <td>{(Number(row.dailyRate) * 100).toFixed(1)}%</td>
                    <td>{money(row.earned)}</td>
                    <td><span className="dash-badge is-success">{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
