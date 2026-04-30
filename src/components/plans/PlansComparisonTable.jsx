import { useMemo, useState } from "react";
import { estimatePlanBreakevenDays, estimatePlanNetDaily } from "../../utils/miningPlanOverrides";

const RISK_ORDER = { low: 1, "low-mid": 2, mid: 3, "mid-high": 4, high: 5 };

function normalizeRisk(value) {
  const raw = String(value || "mid").toLowerCase();
  if (raw.includes("low") && raw.includes("mid")) return "low-mid";
  if (raw.includes("mid") && raw.includes("high")) return "mid-high";
  if (raw.includes("low")) return "low";
  if (raw.includes("high")) return "high";
  return "mid";
}

export function PlansComparisonTable({
  plans,
  selectedPlanId,
  onSelectPlan,
  strategyProfile,
  t,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("price_asc");
  const [riskFilter, setRiskFilter] = useState("all");

  const visiblePlans = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = plans.filter((plan) => {
      const risk = normalizeRisk(strategyProfile?.[plan.strategy]?.risk);
      if (riskFilter !== "all" && risk !== riskFilter) return false;
      if (!term) return true;
      return [plan.name, plan.strategy, String(plan.hashrateValue), String(plan.priceUsdt)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
    return filtered.sort((a, b) => {
      const aProfile = strategyProfile?.[a.strategy];
      const bProfile = strategyProfile?.[b.strategy];
      const aApy = Number(aProfile?.apy || 0);
      const bApy = Number(bProfile?.apy || 0);
      const aNet = estimatePlanNetDaily(a.priceUsdt, aApy, a.name);
      const bNet = estimatePlanNetDaily(b.priceUsdt, bApy, b.name);
      const aRisk = RISK_ORDER[normalizeRisk(aProfile?.risk)] || 3;
      const bRisk = RISK_ORDER[normalizeRisk(bProfile?.risk)] || 3;
      if (sortBy === "price_desc") return Number(b.priceUsdt || 0) - Number(a.priceUsdt || 0);
      if (sortBy === "apy_desc") return bApy - aApy;
      if (sortBy === "net_desc") return bNet - aNet;
      if (sortBy === "risk_asc") return aRisk - bRisk;
      return Number(a.priceUsdt || 0) - Number(b.priceUsdt || 0);
    });
  }, [plans, riskFilter, search, sortBy, strategyProfile]);

  return (
    <div className="plans-compare-shell">
      <div className="plans-compare-toolbar">
        <input
          className="dash-input"
          placeholder={t("plans.searchPlaceholder", { defaultValue: "Search plans..." })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="dash-input dash-select-sm" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="all">{t("plans.filterRiskAll", { defaultValue: "All risk profiles" })}</option>
          <option value="low">{t("plans.filterRiskLow", { defaultValue: "Low" })}</option>
          <option value="low-mid">{t("plans.filterRiskLowMid", { defaultValue: "Low-Mid" })}</option>
          <option value="mid">{t("plans.filterRiskMid", { defaultValue: "Mid" })}</option>
          <option value="mid-high">{t("plans.filterRiskMidHigh", { defaultValue: "Mid-High" })}</option>
          <option value="high">{t("plans.filterRiskHigh", { defaultValue: "High" })}</option>
        </select>
        <select className="dash-input dash-select-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="price_asc">{t("plans.sortPriceAsc", { defaultValue: "Price: low to high" })}</option>
          <option value="price_desc">{t("plans.sortPriceDesc", { defaultValue: "Price: high to low" })}</option>
          <option value="apy_desc">{t("plans.sortApyDesc", { defaultValue: "Projected APY" })}</option>
          <option value="net_desc">{t("plans.sortNetDesc", { defaultValue: "Net/day" })}</option>
          <option value="risk_asc">{t("plans.sortRiskAsc", { defaultValue: "Risk score" })}</option>
        </select>
      </div>

      <div className="table-shell plans-table-shell">
        <table className="dash-table plans-table">
          <thead>
            <tr>
              <th>{t("plans.table.plan", { defaultValue: "Plan" })}</th>
              <th>{t("plans.table.strategy", { defaultValue: "Strategy" })}</th>
              <th>{t("plans.table.risk", { defaultValue: "Risk" })}</th>
              <th>{t("plans.table.hashrate", { defaultValue: "Hashrate" })}</th>
              <th>{t("plans.table.term", { defaultValue: "Term" })}</th>
              <th>{t("plans.table.price", { defaultValue: "Price" })}</th>
              <th>{t("plans.table.apy", { defaultValue: "Projected APY" })}</th>
              <th>{t("plans.table.netDaily", { defaultValue: "Net/day" })}</th>
              <th>{t("plans.table.breakeven", { defaultValue: "Breakeven" })}</th>
              <th>{t("plans.table.action", { defaultValue: "Action" })}</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlans.length === 0 ? (
              <tr>
                <td colSpan={10}>{t("plans.noPlansFound", { defaultValue: "No matching plans." })}</td>
              </tr>
            ) : (
              visiblePlans.map((plan) => {
                const profile = strategyProfile?.[plan.strategy] || {};
                const netDaily = estimatePlanNetDaily(plan.priceUsdt, profile.apy || 0, plan.name);
                const breakevenDays = estimatePlanBreakevenDays(plan.priceUsdt, netDaily, plan.name);
                const breakeven = breakevenDays ? `${breakevenDays}d` : "-";
                const isSelected = Number(selectedPlanId) === Number(plan.id);
                return (
                  <tr key={plan.id} className={isSelected ? "is-row-selected" : ""}>
                    <td>{plan.name}</td>
                    <td>{profile.label || plan.strategy}</td>
                    <td><span className={`dash-badge ${normalizeRisk(profile.risk).includes("high") ? "is-warning" : "is-info"}`}>{profile.risk || "Mid"}</span></td>
                    <td>{plan.hashrateValue} {plan.hashrateUnit}</td>
                    <td>{plan.durationDays} {t("plans.days")}</td>
                    <td>${Number(plan.priceUsdt || 0).toFixed(2)}</td>
                    <td>{Number(profile.apy || 0).toFixed(1)}%</td>
                    <td>${netDaily.toFixed(2)}</td>
                    <td>{breakeven}</td>
                    <td>
                      <button className="dash-btn is-secondary is-sm" type="button" onClick={() => onSelectPlan(plan.id)}>
                        {isSelected ? t("plans.selected", { defaultValue: "Selected" }) : t("plans.selectPlan", { defaultValue: "Select" })}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
