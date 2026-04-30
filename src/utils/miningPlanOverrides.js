const PLAN_OVERRIDES_BY_NAME = {
  "BTC Starter 120T": { netDaily: 2.8, breakevenDays: 160 },
  "KAS Accel 8T": { netDaily: 4.42, breakevenDays: 140 },
  "LTC+DOGE Hybrid 2.5G": { netDaily: 4.33, breakevenDays: 180 },
};

export function getPlanOverride(planName) {
  return PLAN_OVERRIDES_BY_NAME[String(planName || "").trim()] || null;
}

export function estimatePlanNetDaily(priceUsdt, apy, planName) {
  const override = getPlanOverride(planName);
  if (override?.netDaily !== undefined) {
    return Number(override.netDaily);
  }
  const gross = (Number(priceUsdt || 0) * Number(apy || 0)) / 100 / 365;
  const deductions = gross * 0.3;
  return Math.max(0, gross - deductions);
}

export function estimatePlanBreakevenDays(priceUsdt, netDaily, planName) {
  const override = getPlanOverride(planName);
  if (override?.breakevenDays !== undefined) {
    return Number(override.breakevenDays);
  }
  if (!(Number(netDaily) > 0)) return null;
  return Math.ceil(Number(priceUsdt || 0) / Number(netDaily));
}
