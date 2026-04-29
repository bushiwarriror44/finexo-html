import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiAlertCircle, FiShoppingCart } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../api/client";
import { ActionPopupCard } from "../../components/dashboard/ActionPopupCard";
import { ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { getSafeErrorMessage, money, normalizeApiList } from "./utils";

const STRATEGY_PROFILE = {
  btc_sha256: { apy: 24, risk: "Low-Mid" },
  ltc_doge_scrypt: { apy: 25, risk: "Mid" },
  kas_kheavyhash: { apy: 32, risk: "Mid-High" },
};

export function DashboardBuyPowerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [plans, setPlans] = useState([]);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [purchaseOnlyBalance, setPurchaseOnlyBalance] = useState(0);
  const [showInsufficientPopup, setShowInsufficientPopup] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [plansData, balanceData] = await Promise.all([apiGet("/api/user/mining/plans"), apiGet("/api/user/balance")]);
      setPlans(normalizeApiList(plansData));
      setAvailableBalance(Number(balanceData.availableBalance || 0));
      setPurchaseOnlyBalance(Number(balanceData.purchaseOnlyBalance || 0));
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadContracts")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const purchase = async (plan) => {
    setError("");
    setStatus("");
    const price = Number(plan?.priceUsdt || 0);
    if (price > Number(availableBalance || 0)) {
      setShowInsufficientPopup(true);
      return;
    }
    try {
      await apiPost("/api/user/mining/contracts", { planId: plan.id });
      setStatus(t("dashboardCabinet.buyPower.purchaseSuccess", { defaultValue: "Tariff purchased successfully." }));
      navigate("/dashboard/contracts");
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.buyPower.purchaseFailed", { defaultValue: "Purchase failed." })));
    }
  };

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading ? <LoadingSkeleton rows={2} /> : null}
      <div className="dashboard-panel">
        <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.buyPower.title", { defaultValue: "Buy mining power" })}</h5></div>
        <div className="dashboard-panel-body">
          <p className="dash-help">{t("dashboardCabinet.buyPower.hint", { defaultValue: "Select a tariff and start generating daily accruals." })}</p>
          <p><strong>{t("dashboardCabinet.metrics.available")}:</strong> {money(availableBalance)}</p>
          {purchaseOnlyBalance > 0 ? (
            <p className="dash-help">
              {t("dashboardCabinet.withdrawals.bonusNonWithdrawable", { defaultValue: "Bonus tokens are not withdrawable and can only be used for buying power/tariffs." })} ({money(purchaseOnlyBalance)})
            </p>
          ) : null}
          <div className="dashboard-grid dashboard-grid-2">
            {plans.map((plan) => (
              <article className="dashboard-panel metric-card" key={plan.id}>
                <p className="metric-label">{plan.name}</p>
                <h4 className="metric-value">{money(plan.priceUsdt)}</h4>
                <p className="dash-help">{t("plans.power")}: {plan.hashrateValue} {plan.hashrateUnit}</p>
                <p className="dash-help">{t("plans.duration")}: {plan.durationDays} {t("plans.days")}</p>
                <p className="dash-help">APY: {(STRATEGY_PROFILE[plan.strategy]?.apy || 27).toFixed(1)}% / Risk: {STRATEGY_PROFILE[plan.strategy]?.risk || "Mid"}</p>
                <button className="dash-btn is-primary is-sm" type="button" onClick={() => purchase(plan)}>
                  <FiShoppingCart /> {t("dashboardCabinet.buyPower.buyCta", { defaultValue: "Buy tariff" })}
                </button>
              </article>
            ))}
          </div>
        </div>
      </div>

      {showInsufficientPopup ? (
        <div className="auth-modal-backdrop" onClick={() => setShowInsufficientPopup(false)}>
          <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
            <ActionPopupCard
              icon={FiAlertCircle}
              title={t("dashboardCabinet.buyPower.insufficientTitle", { defaultValue: "Insufficient balance" })}
              description={t("dashboardCabinet.buyPower.insufficientText", { defaultValue: "Please top up your balance to buy tariffs." })}
              ctaLabel={t("dashboardCabinet.buyPower.goTopup", { defaultValue: "Go to top-up" })}
              tone="warning"
              onClick={() => {
                setShowInsufficientPopup(false);
                navigate("/dashboard/topups");
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
