import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
	FiActivity,
	FiBarChart2,
	FiCalendar,
	FiDollarSign,
	FiInfo,
	FiLayers,
	FiList,
	FiTarget,
	FiTrendingUp,
	FiZap,
} from 'react-icons/fi';
import { apiGet, apiPost } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { estimatePlanNetDaily, getPlanOverride } from '../../utils/miningPlanOverrides';

const STRATEGY_DEFAULTS = {
	btc_sha256: {
		apy: 24,
		contractPricePerTH: 3.8,
	},
	ltc_doge_scrypt: {
		apy: 25,
		contractPricePerTH: 4.4,
	},
	kas_kheavyhash: {
		apy: 32,
		contractPricePerTH: 4.9,
	},
};

const AVERAGE_MARKET_APY = 8.5;
const STRATEGY_ICONS = {
	btc_sha256: [{ src: '/images/crypto/bitcoin.svg', alt: 'Bitcoin' }],
	kas_kheavyhash: [{ src: '/images/crypto/kaspa.svg', alt: 'Kaspa' }],
	ltc_doge_scrypt: [
		{ src: '/images/crypto/litecoin.svg', alt: 'Litecoin' },
		{ src: '/images/crypto/dogecoin.svg', alt: 'Dogecoin' },
	],
};

function getPlanIcons(plan) {
	if (!plan) return [];
	return STRATEGY_ICONS[plan.strategy] || [];
}

function buildCapitalGrowthSeries(investment, netDaily, durationDays) {
	const pointsCount = 7;
	const safeInvestment = Math.max(0, Number(investment) || 0);
	const safeDaily = Math.max(0, Number(netDaily) || 0);
	const safeDuration = Math.max(30, Number(durationDays) || 30);
	const maxDay = 360;
	const result = [];
	for (let i = 0; i < pointsCount; i += 1) {
		const progress = i / (pointsCount - 1);
		const day = Math.round(maxDay * progress);
		const durationBoost = 1 + Math.min(0.18, (safeDuration - 30) / 1200);
		const capital = safeInvestment + safeDaily * day * durationBoost;
		result.push({
			label: `${Math.round(day / 30)}m`,
			value: capital,
		});
	}
	return result;
}

export function CalculatorSection() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const { user } = useAuth();
	const [mode, setMode] = useState('plans');
	const [plans, setPlans] = useState([]);
	const [selectedPlanId, setSelectedPlanId] = useState(null);
	const [customInvestment, setCustomInvestment] = useState(1000);
	const [customDuration, setCustomDuration] = useState(180);
	const [customStrategy, setCustomStrategy] = useState('btc_sha256');
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const [chartHoverIndex, setChartHoverIndex] = useState(null);

	useEffect(() => {
		apiGet('/api/user/mining/plans')
			.then((rows) => {
				const list = rows || [];
				setPlans(list);
				if (list.length && !selectedPlanId) setSelectedPlanId(list[0].id);
			})
			.catch(() => setPlans([]));
	}, [selectedPlanId]);

	const selectedPlan = useMemo(
		() => plans.find((p) => p.id === Number(selectedPlanId)) || null,
		[plans, selectedPlanId],
	);
	const selectedPlanIcons = useMemo(() => getPlanIcons(selectedPlan), [selectedPlan]);

	const planMetrics = useMemo(() => {
		if (!selectedPlan) return null;
		const strategy = selectedPlan.strategy;
		const profile = STRATEGY_DEFAULTS[strategy] || STRATEGY_DEFAULTS.btc_sha256;
		const investment = Number(selectedPlan.priceUsdt || 0);
		const duration = Number(selectedPlan.durationDays || 180);
		const hashrateTh =
			selectedPlan.hashrateUnit === 'GH/s'
				? Number(selectedPlan.hashrateValue) / 1000
				: Number(selectedPlan.hashrateValue || 0);
		const override = getPlanOverride(selectedPlan.name);
		const baseGrossDaily = (investment * (profile.apy / 100)) / 365;
		const grossDaily = override ? estimatePlanNetDaily(investment, profile.apy, selectedPlan.name) / 0.7 : baseGrossDaily;
		const powerDaily = grossDaily * 0.18;
		const maintenanceDaily = grossDaily * 0.12;
		const netDaily = override
			? estimatePlanNetDaily(investment, profile.apy, selectedPlan.name)
			: Math.max(0, grossDaily - powerDaily - maintenanceDaily);
		const netTotal = netDaily * duration;
		const roi = investment > 0 ? (netTotal / investment) * 100 : 0;
		return {
			hashrateTh,
			grossDaily,
			powerDaily,
			maintenanceDaily,
			netDaily,
			netTotal,
			roi,
			duration,
			investment,
			apy: profile.apy,
		};
	}, [selectedPlan]);

	const customMetrics = useMemo(() => {
		const investment = Math.max(0, Number(customInvestment) || 0);
		const duration = Math.max(1, Number(customDuration) || 1);
		const apy = AVERAGE_MARKET_APY;
		const annualProfit = investment * (apy / 100);
		const netDaily = annualProfit / 365;
		const netTotal = netDaily * duration;
		const approxHashrateTh =
			investment /
			(STRATEGY_DEFAULTS[customStrategy]?.contractPricePerTH ||
				STRATEGY_DEFAULTS.btc_sha256.contractPricePerTH);
		return { apy, netDaily, netTotal, approxHashrateTh };
	}, [customDuration, customInvestment, customStrategy]);

	const activeInvestment =
		mode === 'plans' ? planMetrics?.investment || 0 : Number(customInvestment) || 0;
	const activeNetDaily = mode === 'plans' ? planMetrics?.netDaily || 0 : customMetrics.netDaily;
	const activeDuration = mode === 'plans' ? planMetrics?.duration || 1 : customDuration;
	const growthSeries = useMemo(
		() => buildCapitalGrowthSeries(activeInvestment, activeNetDaily, activeDuration),
		[activeDuration, activeInvestment, activeNetDaily],
	);
	const maxGrowth = useMemo(
		() => Math.max(...growthSeries.map((item) => item.value), 1),
		[growthSeries],
	);
	const minGrowth = useMemo(
		() => Math.min(...growthSeries.map((item) => item.value), 0),
		[growthSeries],
	);
	const growthRange = Math.max(1, maxGrowth - minGrowth);
	const chartLine = growthSeries
		.map((point, idx) => {
			const x = (idx / (growthSeries.length - 1)) * 100;
			const y = 100 - ((point.value - minGrowth) / growthRange) * 100;
			return `${x},${y}`;
		})
		.join(' ');
	const chartArea = `0,100 ${chartLine} 100,100`;
	const lastPoint = chartLine.split(' ').at(-1) || '100,0';
	const finalCapital = growthSeries[growthSeries.length - 1]?.value || 0;
	const netProfit = Math.max(0, finalCapital - activeInvestment);
	const annualized = activeInvestment > 0 ? (netProfit / activeInvestment) * 100 : 0;
	const planAdditionalDaily = planMetrics
		? planMetrics.powerDaily + planMetrics.maintenanceDaily
		: 0;
	const planAdditionalMonthly = planAdditionalDaily * 30;
	const planAdditionalTotal = planMetrics ? planAdditionalDaily * planMetrics.duration : 0;
	const activeHoverIndex = chartHoverIndex ?? growthSeries.length - 1;
	const activeHoverPoint = growthSeries[activeHoverIndex] || growthSeries[growthSeries.length - 1];
	const hoverX = growthSeries.length > 1 ? (activeHoverIndex / (growthSeries.length - 1)) * 100 : 0;
	const hoverY = activeHoverPoint
		? 100 - ((activeHoverPoint.value - minGrowth) / growthRange) * 100
		: 100;

	const updateChartHover = (event) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (!rect.width) return;
		const rawX = event.clientX - rect.left;
		const clampedX = Math.max(0, Math.min(rect.width, rawX));
		const ratio = clampedX / rect.width;
		const idx = Math.round(ratio * (growthSeries.length - 1));
		setChartHoverIndex(Math.max(0, Math.min(growthSeries.length - 1, idx)));
	};
	const openAuthModal = () => {
		const cleanParams = new URLSearchParams(location.search);
		cleanParams.delete('auth');
		cleanParams.delete('token');
		cleanParams.delete('next');
		const nextQuery = cleanParams.toString();
		const nextPath = `${location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
		const params = new URLSearchParams(location.search);
		params.set('auth', 'login');
		params.set('next', nextPath);
		navigate(`${location.pathname}?${params.toString()}`);
	};

	return (
		<section id="profitability-calculator" className="about_section layout_padding calculator_page">
			<div className="container">
				<div className="heading_container heading_center">
					<h2>{t('sections.calculatorTitle')}</h2>
					<p>{t('calculator.subtitleSimple')}</p>
				</div>
				<div className="calculator-hero-metrics">
					<div className="calc-metric-tile">
						<span>{t('calculator.marketApyLabel')}</span>
						<strong>8.5% APY</strong>
					</div>
					<div className="calc-metric-tile">
						<span>{t('calculator.modePlans')}</span>
						<strong>{plans.length || 0} plans</strong>
					</div>
					<div className="calc-metric-tile">
						<span>{t('calculator.modeQuickHashrate')}</span>
						<strong>2-click flow</strong>
					</div>
				</div>
				<div className="calculator-mode-switch ">
					<button
						type="button"
						className={`calculator-mode-btn ${mode === 'plans' ? 'is-active' : ''}`}
						onClick={() => setMode('plans')}>
						{t('calculator.modePlans')}
					</button>
					<button
						type="button"
						className={`calculator-mode-btn ${mode === 'quick' ? 'is-active' : ''}`}
						onClick={() => setMode('quick')}>
						{t('calculator.modeQuickHashrate')}
					</button>
				</div>
				<div className="row g-4 align-items-start">
					<div className="col-lg-7">
						<div className="detail-box calc-input-card">
							<div className="calc-input-header">
								<strong>
									{mode === 'plans' ? t('calculator.modePlans') : t('calculator.modeQuickHashrate')}
								</strong>
								<span>{t('calculator.projectionModelLabel')}</span>
							</div>
							{mode === 'plans' ? (
								<div className="row">
									<div className="col-md-12 mb-3">
										<label className="d-block mb-2">{t('calculator.choosePlan')}</label>
										<select
											className="form-control"
											value={selectedPlanId || ''}
											onChange={(e) => setSelectedPlanId(Number(e.target.value))}>
											{plans.map((plan) => (
												<option key={plan.id} value={plan.id}>
													{plan.name} · ${plan.priceUsdt} · {plan.durationDays} {t('plans.days')}
												</option>
											))}
										</select>
										{selectedPlanIcons.length ? (
											<div className="calc-plan-assets" aria-label="Selected plan assets">
												{selectedPlanIcons.map((icon) => (
													<span key={`${selectedPlan?.id || 'none'}_${icon.alt}`} className="calc-plan-asset-chip">
														<img src={icon.src} alt={icon.alt} width="16" height="16" loading="lazy" />
														{icon.alt}
													</span>
												))}
											</div>
										) : null}
										{plans.length ? (
											<div className="calc-plan-icons-legend" aria-label="Plan asset legend">
												{plans.map((plan) => {
													const icons = getPlanIcons(plan);
													return (
														<div key={`legend_${plan.id}`} className="calc-plan-icons-legend-row">
															<span className="calc-plan-icons-legend-name">{plan.name}</span>
															<span className="calc-plan-icons-legend-assets">
																{icons.map((icon) => (
																	<img
																		key={`legend_${plan.id}_${icon.alt}`}
																		src={icon.src}
																		alt={icon.alt}
																		width="14"
																		height="14"
																		loading="lazy"
																	/>
																))}
															</span>
														</div>
													);
												})}
											</div>
										) : null}
									</div>
									<div className="col-md-6 mb-2">
										<label className="d-block mb-2">{t('calculator.strategy')}</label>
										<input
											className="form-control"
											value={selectedPlan?.strategy || '-'}
											readOnly
										/>
									</div>
									<div className="col-md-6 mb-2">
										<label className="d-block mb-2">{t('calculator.investmentUsdt')}</label>
										<input
											className="form-control"
											value={selectedPlan ? `$${selectedPlan.priceUsdt}` : '-'}
											readOnly
										/>
									</div>
									<div className="col-md-12 mt-2">
										<div className="calc-plan-hint">{t('calculator.bundleHint')}</div>
									</div>
								</div>
							) : (
								<div className="row">
									<div className="col-md-6 mb-3">
										<label className="d-block mb-2">{t('calculator.investmentUsdt')}</label>
										<input
											className="form-control"
											type="number"
											min="100"
											value={customInvestment}
											onChange={(e) => setCustomInvestment(Number(e.target.value || 0))}
										/>
									</div>
									<div className="col-md-6 mb-3">
										<label className="d-block mb-2">{t('calculator.duration')}</label>
										<input
											className="form-control"
											type="number"
											min="30"
											value={customDuration}
											onChange={(e) => setCustomDuration(Number(e.target.value || 30))}
										/>
									</div>
									<div className="col-md-12 mb-2">
										<label className="d-block mb-2">{t('calculator.strategy')}</label>
										<select
											className="form-control"
											value={customStrategy}
											onChange={(e) => setCustomStrategy(e.target.value)}>
											<option value="btc_sha256">{t('calculator.strategyBtc')}</option>
											<option value="ltc_doge_scrypt">{t('calculator.strategyLtcDoge')}</option>
											<option value="kas_kheavyhash">{t('calculator.strategyKas')}</option>
										</select>
									</div>
									<div className="col-md-12 mt-2">
										<div className="calc-plan-hint">{t('calculator.quickModeHint2')}</div>
									</div>
								</div>
							)}
							<div className="capital-growth-card mt-3">
								<div className="capital-growth-head">
									<strong>{t('calculator.capitalGrowthTitle')}</strong>
									<span>
										{t('calculator.finalCapital')}: ${finalCapital.toFixed(2)}
									</span>
								</div>
								<div
									className="capital-growth-chart-wrap"
									onMouseMove={updateChartHover}
									onMouseLeave={() => setChartHoverIndex(null)}>
									<svg
										className="capital-growth-chart"
										viewBox="0 0 100 100"
										preserveAspectRatio="none"
										aria-hidden="true">
										<defs>
											<linearGradient id="capitalGrowthFill" x1="0" x2="0" y1="0" y2="1">
												<stop offset="0%" stopColor="rgba(0, 187, 240, 0.38)" />
												<stop offset="100%" stopColor="rgba(0, 187, 240, 0.02)" />
											</linearGradient>
										</defs>
										<line x1="0" y1="80" x2="100" y2="80" className="capital-growth-gridline" />
										<line x1="0" y1="60" x2="100" y2="60" className="capital-growth-gridline" />
										<line x1="0" y1="40" x2="100" y2="40" className="capital-growth-gridline" />
										<line x1="0" y1="20" x2="100" y2="20" className="capital-growth-gridline" />
										<polygon points={chartArea} fill="url(#capitalGrowthFill)" />
										<polyline
											points={chartLine}
											fill="none"
											stroke="#00bbf0"
											strokeWidth="2.5"
											strokeLinecap="round"
										/>
										<circle
											cx={lastPoint.split(',')[0]}
											cy={lastPoint.split(',')[1]}
											r="2.3"
											className="capital-growth-dot"
										/>
										{activeHoverPoint ? (
											<circle
												cx={hoverX}
												cy={hoverY}
												r="2.6"
												className="capital-growth-dot capital-growth-dot-active"
											/>
										) : null}
									</svg>
									{activeHoverPoint ? (
										<div
											className="capital-growth-tooltip"
											style={{ left: `clamp(52px, ${hoverX}%, calc(100% - 52px))` }}>
											<strong>{activeHoverPoint.label}</strong>
											<span>${activeHoverPoint.value.toFixed(2)}</span>
										</div>
									) : null}
									<div className="capital-growth-axis">
										{growthSeries.map((point) => (
											<span key={`${point.label}_${point.value}`}>{point.label}</span>
										))}
									</div>
								</div>
								<div className="capital-growth-stats">
									<div>
										<span>{t('calculator.startCapital')}</span>
										<strong>${activeInvestment.toFixed(2)}</strong>
									</div>
									<div>
										<span>{t('calculator.projectedProfit')}</span>
										<strong>${netProfit.toFixed(2)}</strong>
									</div>
								</div>
							</div>
						</div>
					</div>
					<div className="col-lg-5">
						<div className="box calc-results-card">
							<div className="detail-box text-start w-100">
								<h5 className="mb-3">{t('calculator.resultsTitle')}</h5>
								<div className="calc-headline-metric">
									<span>{t('calculator.projected12mCapital')}</span>
									<strong>${finalCapital.toFixed(2)}</strong>
								</div>
								{mode === 'plans' && planMetrics ? (
									<>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiBarChart2 aria-hidden="true" />
												{t('calculator.baselineApy')}
											</span>
											<strong>{planMetrics.apy.toFixed(1)}%</strong>
										</div>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiActivity aria-hidden="true" />
												{t('calculator.estimatedHashrate')}
											</span>
											<strong>{planMetrics.hashrateTh.toFixed(2)} TH/s</strong>
										</div>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiDollarSign aria-hidden="true" />
												{t('calculator.grossDaily')}
											</span>
											<strong>${planMetrics.grossDaily.toFixed(2)}</strong>
										</div>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiLayers aria-hidden="true" />
												{t('calculator.additionalCosts')}
												<span className="calc-info-wrap">
													<FiInfo className="calc-info-icon" aria-hidden="true" />
													<span className="calc-info-tooltip">
														<strong>{t('calculator.additionalBreakdownTitle')}</strong>
														<span>
															{t('calculator.powerDaily')}: -${planMetrics.powerDaily.toFixed(2)}
														</span>
														<span>
															{t('calculator.maintenanceDaily')}: -$
															{planMetrics.maintenanceDaily.toFixed(2)}
														</span>
														<span>
															{t('calculator.additionalMonthly')}: -$
															{planAdditionalMonthly.toFixed(2)}
														</span>
														<span>
															{t('calculator.additionalTotal')}: -${planAdditionalTotal.toFixed(2)}
														</span>
													</span>
												</span>
											</span>
											<strong>-${planAdditionalDaily.toFixed(2)}</strong>
										</div>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiZap aria-hidden="true" />
												{t('calculator.netDaily')}
											</span>
											<strong>${planMetrics.netDaily.toFixed(2)}</strong>
										</div>
										<div className="calc-result-row is-highlight">
											<span className="calc-result-label">
												<FiTrendingUp aria-hidden="true" />
												{t('calculator.projectedRoi')}
											</span>
											<strong>{planMetrics.roi.toFixed(2)}%</strong>
										</div>
									</>
								) : null}
								{mode === 'quick' ? (
									<>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiBarChart2 aria-hidden="true" />
												{t('calculator.marketApyLabel')}
											</span>
											<strong>{customMetrics.apy.toFixed(1)}% / year</strong>
										</div>
										<div className="calc-result-row">
											<span className="calc-result-label">
												<FiActivity aria-hidden="true" />
												{t('calculator.estimatedHashrate')}
											</span>
											<strong>{customMetrics.approxHashrateTh.toFixed(2)} TH/s</strong>
										</div>
										<div className="calc-result-row is-highlight">
											<span className="calc-result-label">
												<FiZap aria-hidden="true" />
												{t('calculator.netDaily')}
											</span>
											<strong>${customMetrics.netDaily.toFixed(2)}</strong>
										</div>
									</>
								) : null}
								<hr />
								<div className="calc-result-row">
									<span className="calc-result-label">
										<FiDollarSign aria-hidden="true" />
										{t('calculator.netMonthly')}
									</span>
									<strong>
										$
										{(mode === 'plans' && planMetrics
											? planMetrics.netDaily * 30
											: customMetrics.netDaily * 30
										).toFixed(2)}
									</strong>
								</div>
								<div className="calc-result-row">
									<span className="calc-result-label">
										<FiDollarSign aria-hidden="true" />
										{t('calculator.netTotal')}
									</span>
									<strong>
										$
										{(mode === 'plans' && planMetrics
											? planMetrics.netTotal
											: customMetrics.netTotal
										).toFixed(2)}
									</strong>
								</div>
								<div className="calc-result-row is-highlight">
									<span className="calc-result-label">
										<FiTrendingUp aria-hidden="true" />
										{t('calculator.projected12mRoi')}
									</span>
									<strong>{annualized.toFixed(2)}%</strong>
								</div>
								{status ? <p className="text-info mt-2 mb-0">{status}</p> : null}
								{error ? <p className="text-warning mt-2 mb-0">{error}</p> : null}
								{mode === 'plans' ? (
									<button
										className="btn btn-info text-white w-100 mt-3"
										type="button"
										disabled={!selectedPlan}
										onClick={async () => {
											if (!selectedPlan) return;
											if (!user) {
												openAuthModal();
												return;
											}
											setStatus('');
											setError('');
											try {
												await apiPost('/api/user/mining/contracts', { planId: selectedPlan.id });
												setStatus(t('calculator.buyPlanSuccess'));
												navigate('/dashboard/contracts');
											} catch (err) {
												setError(err.message);
											}
										}}>
										{t('calculator.buySelectedPlan')}
									</button>
								) : (
									<button
										className="btn btn-info text-white w-100 mt-3"
										type="button"
										onClick={() => {
											if (!user) {
												openAuthModal();
												return;
											}
											setStatus(t('calculator.quickHashrateHint'));
										}}>
										{t('calculator.buyHashrateQuick')}
									</button>
								)}
							</div>
						</div>
						<p className="mt-3 mb-0 small text-muted">{t('calculator.marketApyNote')}</p>
						<p className="mt-2 mb-0 small text-muted">{t('calculator.disclaimer')}</p>
					</div>
				</div>
			</div>
		</section>
	);
}
