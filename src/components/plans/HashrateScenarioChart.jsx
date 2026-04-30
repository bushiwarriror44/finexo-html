import { useMemo, useState } from "react";

const SCENARIOS = [
  { key: "base", label: "Base", modifier: 1, color: "#00bbf0" },
  { key: "conservative", label: "Conservative", modifier: 0.75, color: "#22c55e" },
  { key: "stress", label: "Stress", modifier: 0.45, color: "#f59e0b" },
];

function buildSeries(investment, netDaily, months, modifier) {
  const points = [];
  for (let i = 0; i <= months; i += 1) {
    const day = i * 30;
    points.push({ x: i, value: Number(investment || 0) + Number(netDaily || 0) * day * modifier });
  }
  return points;
}

export function HashrateScenarioChart({ investment, netDaily, forcedBreakevenDays = null, t }) {
  const [horizon, setHorizon] = useState(12);
  const series = useMemo(
    () => SCENARIOS.map((s) => ({ ...s, points: buildSeries(investment, netDaily, horizon, s.modifier) })),
    [horizon, investment, netDaily]
  );
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  const range = Math.max(1, max - min);
  const xDivider = horizon || 1;

  const lineFor = (points) =>
    points
      .map((point) => {
        const x = (point.x / xDivider) * 100;
        const y = 100 - ((point.value - min) / range) * 100;
        return `${x},${y}`;
      })
      .join(" ");

  const base = series[0]?.points?.at(-1)?.value || investment;
  const conservative = series[1]?.points?.at(-1)?.value || investment;
  const stress = series[2]?.points?.at(-1)?.value || investment;
  const netMonthBase = Number(netDaily || 0) * 30;
  const breakevenDays = forcedBreakevenDays || (netDaily > 0 ? Math.ceil(Number(investment || 0) / Number(netDaily || 1)) : null);

  return (
    <div className="scenario-chart-card">
      <div className="scenario-chart-head">
        <strong>{t("plans.scenarioTitle", { defaultValue: "Hashrate scenarios" })}</strong>
        <div className="scenario-horizon">
          {[3, 6, 12].map((m) => (
            <button
              key={m}
              type="button"
              className={`dash-btn is-sm ${horizon === m ? "is-primary" : "is-secondary"}`}
              onClick={() => setHorizon(m)}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="scenario-chart-svg" aria-hidden="true">
        {[20, 40, 60, 80].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} className="capital-growth-gridline" />
        ))}
        {series.map((s) => (
          <polyline key={s.key} points={lineFor(s.points)} fill="none" stroke={s.color} strokeWidth="2.2" />
        ))}
      </svg>
      <div className="scenario-legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{t(`plans.scenario.${s.key}`, { defaultValue: s.label })}</span>
        ))}
      </div>
      <div className="capital-growth-stats">
        <div>
          <span>{t("plans.kpi.netDaily", { defaultValue: "Net/day (base)" })}</span>
          <strong>${Number(netDaily || 0).toFixed(2)}</strong>
        </div>
        <div>
          <span>{t("plans.kpi.netMonthly", { defaultValue: "Net/month (base)" })}</span>
          <strong>${netMonthBase.toFixed(2)}</strong>
        </div>
        <div>
          <span>{t("plans.kpi.yearRange", { defaultValue: "12M capital range" })}</span>
          <strong>${stress.toFixed(0)} - ${base.toFixed(0)}</strong>
        </div>
        <div>
          <span>{t("plans.kpi.breakeven", { defaultValue: "Breakeven" })}</span>
          <strong>{breakevenDays ? `${breakevenDays}d` : "-"}</strong>
        </div>
        <div>
          <span>{t("plans.kpi.baseFinal", { defaultValue: "Base final" })}</span>
          <strong>${base.toFixed(2)}</strong>
        </div>
        <div>
          <span>{t("plans.kpi.conservativeFinal", { defaultValue: "Conservative final" })}</span>
          <strong>${conservative.toFixed(2)}</strong>
        </div>
      </div>
    </div>
  );
}
