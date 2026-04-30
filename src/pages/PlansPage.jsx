import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { SectionHeading } from "../components/ui/SectionHeading";
import { PlansComparisonTable } from "../components/plans/PlansComparisonTable";
import { HashrateScenarioChart } from "../components/plans/HashrateScenarioChart";
import { TopupModal } from "../components/dashboard/TopupModal";
import { useAuth } from "../context/AuthContext";
import { estimatePlanBreakevenDays, estimatePlanNetDaily } from "../utils/miningPlanOverrides";

const STRATEGY_PROFILE = {
  btc_sha256: { apy: 24, risk: "Low-Mid", color: "#00bbf0", label: "BTC SHA-256" },
  ltc_doge_scrypt: { apy: 25, risk: "Mid", color: "#22c55e", label: "LTC+DOGE Scrypt" },
  kas_kheavyhash: { apy: 32, risk: "Mid-High", color: "#a855f7", label: "KAS kHeavyHash" },
};

function buildCapitalCurve(investment, apy) {
  const months = 12;
  const monthlyRate = apy / 12 / 100;
  const points = [];
  let capital = Math.max(0, Number(investment) || 0);
  for (let i = 0; i <= months; i += 1) {
    if (i > 0) {
      const wave = Math.sin(i * 0.9) * 0.04;
      const adjusted = Math.max(0, monthlyRate * (1 + wave));
      capital += capital * adjusted;
    }
    points.push({ x: i, y: capital, label: i === 0 ? "Start" : `M${i}` });
  }
  return points;
}

function YieldSparkline({ investment, apy, color }) {
  const points = buildCapitalCurve(investment, apy);
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const minY = Math.min(...points.map((p) => p.y), 0);
  const range = Math.max(1, maxY - minY);
  const linePoints = points
    .map((p) => {
      const x = (p.x / (points.length - 1 || 1)) * 100;
      const y = 100 - ((p.y - minY) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPoints = `0,100 ${linePoints} 100,100`;
  const finalCapital = points[points.length - 1]?.y || 0;
  return (
    <div className="yield-chart-wrap">
      <div className="yield-chart-head">
        <span>Capital growth</span>
        <strong>${finalCapital.toFixed(2)}</strong>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="yield-chart" aria-hidden="true">
        <defs>
          <linearGradient id={`yieldFill_${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.38" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill={`url(#yieldFill_${color.replace("#", "")})`} />
        <polyline fill="none" stroke={color} strokeWidth="2.8" points={linePoints} />
      </svg>
      <div className="yield-chart-axis">
        <span>Start ${Number(investment || 0).toFixed(0)}</span>
        <span>12 mo</span>
      </div>
    </div>
  );
}

export function PlansPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet("/api/user/mining/plans")
      .then((data) => {
        const list = data || [];
        setPlans(list);
        if (list.length && !selectedPlanId) setSelectedPlanId(list[0].id);
      })
      .catch((err) => setError(err.message));
  }, [selectedPlanId]);

  useEffect(() => {
    if (!user) return;
    apiGet("/api/user/balance")
      .then((data) => setAvailableBalance(Number(data.availableBalance || 0)))
      .catch(() => setAvailableBalance(0));
    apiGet("/api/wallet/addresses")
      .then((rows) => setWallets(rows || []))
      .catch(() => setWallets([]));
  }, [user]);

  const selectedPlan = plans.find((plan) => Number(plan.id) === Number(selectedPlanId)) || null;
  const selectedProfile = selectedPlan ? STRATEGY_PROFILE[selectedPlan.strategy] || null : null;
  const selectedNetDaily = selectedPlan
    ? estimatePlanNetDaily(selectedPlan.priceUsdt, selectedProfile?.apy || 0, selectedPlan.name)
    : 0;
  const selectedBreakevenDays = selectedPlan
    ? estimatePlanBreakevenDays(selectedPlan.priceUsdt, selectedNetDaily, selectedPlan.name)
    : null;
  const openAuthModal = () => {
    const cleanParams = new URLSearchParams(location.search);
    cleanParams.delete("auth");
    cleanParams.delete("token");
    cleanParams.delete("next");
    const nextQuery = cleanParams.toString();
    const nextPath = `${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    const params = new URLSearchParams(location.search);
    params.set("auth", "login");
    params.set("next", nextPath);
    navigate(`${location.pathname}?${params.toString()}`);
  };

  return (
    <section className="service_section layout_padding plans_page">
      <div className="service_container">
        <div className="container">
          <SectionHeading title={t("sections.plansTitle")} />
          <div className="plans-insight">
            <strong>Target portfolio APY:</strong> 27% yearly (strategy mix simulation).
          </div>
          <PlansComparisonTable
            plans={plans}
            selectedPlanId={selectedPlanId}
            onSelectPlan={setSelectedPlanId}
            strategyProfile={STRATEGY_PROFILE}
            t={t}
          />
          <HashrateScenarioChart
            investment={selectedPlan?.priceUsdt || 0}
            netDaily={selectedNetDaily}
            forcedBreakevenDays={selectedBreakevenDays}
            t={t}
          />

          {status ? <p className="text-success">{status}</p> : null}
          {error ? <p className="text-danger">{error}</p> : null}
          <div className="row">
            {plans.map((plan) => {
              const isSelected = Number(plan.id) === Number(selectedPlanId);
              return (
              <div className="col-md-4" key={plan.id}>
                <div className={`box ${isSelected ? "is-selected-plan" : ""}`}>
                  <div className="detail-box">
                    <div className="plan-badges">
                      <span className="plan-badge">{STRATEGY_PROFILE[plan.strategy]?.label || plan.strategy}</span>
                      <span className="plan-badge is-muted">Risk: {STRATEGY_PROFILE[plan.strategy]?.risk || "Mid"}</span>
                    </div>
                    <h5>{plan.name}</h5>
                    <p>{t("plans.power")}: {plan.hashrateValue} {plan.hashrateUnit}</p>
                    <p>{t("plans.duration")}: {plan.durationDays} {t("plans.days")}</p>
                    <p>{t("plans.price")}: ${plan.priceUsdt}</p>
                    <p><strong>Projected APY:</strong> {(STRATEGY_PROFILE[plan.strategy]?.apy || 27).toFixed(1)}%</p>
                    <p className="plan-meta">Daily payout model with variable network and fee factors</p>
                    <YieldSparkline
                      investment={plan.priceUsdt}
                      apy={STRATEGY_PROFILE[plan.strategy]?.apy || 27}
                      color={STRATEGY_PROFILE[plan.strategy]?.color || "#00bbf0"}
                    />
                    <button
                      className="btn btn-info text-white"
                      type="button"
                      disabled={!isSelected}
                      onClick={async () => {
                        if (!user) {
                          openAuthModal();
                          return;
                        }
                        setError("");
                        setStatus("");
                        try {
                          const price = Number(plan.priceUsdt || 0);
                          if (price > Number(availableBalance || 0)) {
                            setStatus(t("plans.needTopup", { defaultValue: "Insufficient available balance. Please top up to continue." }));
                            setShowTopupModal(true);
                            return;
                          }
                          await apiPost("/api/user/mining/contracts", { planId: plan.id });
                          setStatus(`Plan "${plan.name}" purchased successfully.`);
                          navigate("/dashboard/contracts");
                        } catch (err) {
                          setError(err.message);
                        }
                      }}
                    >
                      Buy hashrate
                    </button>
                  </div>
                </div>
              </div>
            )})}
          </div>
          <div className="plans-marketing">
            <h4>{t("plans.marketingTitle")}</h4>
            <p>{t("plans.marketingText")}</p>
          </div>
          <TopupModal
            isOpen={showTopupModal}
            wallets={wallets}
            onClose={() => setShowTopupModal(false)}
            onSubmit={async (payload) => {
              await apiPost("/api/wallet/topup", payload);
              const balanceData = await apiGet("/api/user/balance");
              setAvailableBalance(Number(balanceData.availableBalance || 0));
              setStatus(t("dashboardCabinet.messages.topupSubmitted"));
            }}
            t={t}
          />
        </div>
      </div>
    </section>
  );
}
