import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost } from '../../api/client';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/dashboard/StateBlocks';
import { getSafeErrorMessage, money } from './utils';
import { FiCheckCircle, FiClock, FiDollarSign, FiTrendingUp } from 'react-icons/fi';

const STAKING_TERM_DAYS = 30;

export function DashboardStakingPage() {
	const { t } = useTranslation();
	const [tiers, setTiers] = useState([]);
	const [positions, setPositions] = useState([]);
	const [summary, setSummary] = useState({
		totalInvestedUsdt: 0,
		totalEarnedUsdt: 0,
		activePositions: 0,
	});
	const [amountByTier, setAmountByTier] = useState({});
	const [loading, setLoading] = useState(false);
	const [submittingTierId, setSubmittingTierId] = useState(null);
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');
	const [confirmTier, setConfirmTier] = useState(null);
	const [confirmAmount, setConfirmAmount] = useState('');
	const [resultOpen, setResultOpen] = useState(false);
	const [resultMessage, setResultMessage] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [tiersData, positionsData, summaryData] = await Promise.all([
				apiGet('/api/user/staking/tiers'),
				apiGet('/api/user/staking/positions'),
				apiGet('/api/user/staking/summary'),
			]);
			setTiers(Array.isArray(tiersData) ? tiersData : []);
			setPositions(Array.isArray(positionsData) ? positionsData : []);
			setSummary(summaryData || { totalInvestedUsdt: 0, totalEarnedUsdt: 0, activePositions: 0 });
		} catch (err) {
			setError(
				getSafeErrorMessage(
					err,
					t('dashboardCabinet.messages.failedLoadStaking', {
						defaultValue: 'Failed to load staking data.',
					}),
				),
			);
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		const runLoad = () => {
			load().catch(() => {});
		};
		const timer = setTimeout(runLoad, 0);
		const interval = setInterval(runLoad, 15000);
		return () => {
			clearTimeout(timer);
			clearInterval(interval);
		};
	}, [load]);

	useEffect(() => {
		if (!status) return undefined;
		const timer = setTimeout(() => setStatus(''), 3500);
		return () => clearTimeout(timer);
	}, [status]);

	const hourlyYield = useMemo(() => {
		return positions.reduce(
			(acc, position) => acc + Number(position.amount || 0) * Number(position.hourlyRate || 0),
			0,
		);
	}, [positions]);

	const invest = (tier) => {
		setConfirmTier(tier);
		setConfirmAmount(String(amountByTier[tier.id] || ''));
	};

	const closeConfirm = () => {
		if (submittingTierId) return;
		setConfirmTier(null);
		setConfirmAmount('');
	};

	const closeResult = () => {
		setResultOpen(false);
		setResultMessage('');
	};

	const projectedDividends30d = useMemo(() => {
		if (!confirmTier) return 0;
		const value = Number(confirmAmount || 0);
		if (!Number.isFinite(value) || value <= 0) return 0;
		return value * Number(confirmTier.dailyRate || 0) * STAKING_TERM_DAYS;
	}, [confirmTier, confirmAmount]);

	const confirmSchedule = useMemo(() => {
		if (!confirmTier) return null;
		const start = new Date();
		const end = new Date(start.getTime() + STAKING_TERM_DAYS * 24 * 60 * 60 * 1000);
		return { start, end };
	}, [confirmTier]);

	const simpleAprPercent = useMemo(() => {
		if (!confirmTier) return 0;
		return Number(confirmTier.dailyRate || 0) * 365 * 100;
	}, [confirmTier]);

	const projectedTotalAtEnd = useMemo(() => {
		const principal = Number(confirmAmount || 0);
		if (!confirmTier || !Number.isFinite(principal) || principal <= 0) return 0;
		return principal + projectedDividends30d;
	}, [confirmTier, confirmAmount, projectedDividends30d]);

	const confirmInvest = async () => {
		if (!confirmTier) return;
		const value = Number(confirmAmount || 0);
		if (!Number.isFinite(value) || value <= 0) {
			setResultMessage(
				t('dashboardCabinet.staking.invalidAmount', { defaultValue: 'Enter a valid amount.' }),
			);
			setResultOpen(true);
			return;
		}
		if (value < Number(confirmTier.minAmount || 0) || value > Number(confirmTier.maxAmount || 0)) {
			setResultMessage(
				t('dashboardCabinet.staking.rangeHint', {
					defaultValue: 'Available range: {{min}} - {{max}} USDT.',
					min: Number(confirmTier.minAmount || 0),
					max: Number(confirmTier.maxAmount || 0),
				}),
			);
			setResultOpen(true);
			return;
		}
		setAmountByTier((prev) => ({ ...prev, [confirmTier.id]: String(value) }));
		setSubmittingTierId(confirmTier.id);
		setError('');
		try {
			await apiPost('/api/user/staking/invest', { amount: value });
			setStatus(
				t('dashboardCabinet.staking.investSuccess', {
					defaultValue: 'Investment opened successfully.',
				}),
			);
			closeConfirm();
			await load();
		} catch (err) {
			const amountFieldCode = err?.details?.fields?.amount;
			if (err?.code === 'INSUFFICIENT_BALANCE' || amountFieldCode === 'INSUFFICIENT') {
				setResultMessage(
					t('dashboardCabinet.staking.insufficientBalance', {
						defaultValue: 'Insufficient balance.',
					}),
				);
				setResultOpen(true);
			} else if (
				err?.code === 'STAKING_INVALID_AMOUNT' ||
				amountFieldCode === 'INVALID' ||
				amountFieldCode === 'OUT_OF_RANGE'
			) {
				setResultMessage(
					t('dashboardCabinet.staking.invalidAmount', { defaultValue: 'Enter a valid amount.' }),
				);
				setResultOpen(true);
			} else {
				setError(
					getSafeErrorMessage(
						err,
						t('dashboardCabinet.staking.investFailed', {
							defaultValue: 'Failed to open staking position.',
						}),
					),
				);
			}
		} finally {
			setSubmittingTierId(null);
		}
	};

	return (
		<>
			<ErrorState
				message={error}
				onRetry={() => load().catch(() => {})}
				retryLabel={t('dashboardCabinet.actions.retry')}
			/>
			{status ? <p className="dash-alert is-success">{status}</p> : null}
			{loading ? <LoadingSkeleton rows={3} /> : null}
			<div className="dashboard-panel">
				<div className="dashboard-panel-header">
					<h5>{t('dashboardCabinet.staking.title', { defaultValue: 'USDT Staking' })}</h5>
				</div>
				<div className="dashboard-panel-body">
					<p className="dash-help">
						{t('dashboardCabinet.staking.autoCreditHint', {
							defaultValue:
								'Staking profit is accrued hourly and automatically credited to your main balance for normal withdrawal flow.',
						})}
					</p>
					<div className="dashboard-grid dashboard-grid-5">
						<article className="metric-card is-primary">
							<FiDollarSign className="metric-icon" />
							<p className="metric-label">
								{t('dashboardCabinet.staking.totalInvested', { defaultValue: 'Total Invested' })}
							</p>
							<h4 className="metric-value">{money(summary.totalInvestedUsdt || 0)}</h4>
						</article>
						<article className="metric-card">
							<FiTrendingUp className="metric-icon" />
							<p className="metric-label">
								{t('dashboardCabinet.staking.totalEarned', { defaultValue: 'Total Earned' })}
							</p>
							<h4 className="metric-value">{money(summary.totalEarnedUsdt || 0)}</h4>
						</article>
						<article className="metric-card">
							<FiClock className="metric-icon" />
							<p className="metric-label">
								{t('dashboardCabinet.staking.hourlyYield', { defaultValue: 'Hourly Yield' })}
							</p>
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
								{tier.isHotOffer ? (
									<span className="dash-badge is-warning">
										{t('dashboardCabinet.staking.hotOffer', { defaultValue: 'Hot offer' })}
									</span>
								) : null}
							</div>
							<h5>
								{Number(tier.minAmount).toLocaleString()} -{' '}
								{Number(tier.maxAmount).toLocaleString()} USDT
							</h5>
							<p>
								{(Number(tier.dailyRate) * 100).toFixed(1)}% /{' '}
								{t('dashboardCabinet.staking.day', { defaultValue: 'day' })}
							</p>
							<input
								className="dash-input"
								type="number"
								min={tier.minAmount}
								max={tier.maxAmount}
								step="0.01"
								placeholder={t('dashboardCabinet.staking.amountPlaceholder', {
									defaultValue: 'Amount in USDT',
								})}
								value={amountByTier[tier.id] || ''}
								onChange={(e) =>
									setAmountByTier((prev) => ({ ...prev, [tier.id]: e.target.value }))
								}
							/>
							<button
								className="dash-btn is-primary"
								type="button"
								disabled={submittingTierId === tier.id}
								onClick={() => invest(tier)}>
								{submittingTierId === tier.id
									? t('dashboardCabinet.actions.submitting', { defaultValue: 'Submitting...' })
									: t('dashboardCabinet.staking.invest', { defaultValue: 'Invest' })}
							</button>
						</div>
					</article>
				))}
			</div>
			<div className="dashboard-panel">
				<div className="dashboard-panel-header">
					<h5>
						{t('dashboardCabinet.staking.positionsTitle', {
							defaultValue: 'Active staking positions',
						})}
					</h5>
				</div>
				<div className="dashboard-panel-body">
					<div className="table-shell">
						<table className="dash-table">
							<thead>
								<tr>
									<th>ID</th>
									<th>{t('dashboardCabinet.table.amount')}</th>
									<th>{t('dashboardCabinet.staking.dailyRate', { defaultValue: 'Daily rate' })}</th>
									<th>{t('dashboardCabinet.staking.earned', { defaultValue: 'Earned' })}</th>
									<th>
										{t('dashboardCabinet.staking.lockUntil', {
											defaultValue: 'Principal lock until',
										})}
									</th>
									<th>{t('dashboardCabinet.table.status')}</th>
								</tr>
							</thead>
							<tbody>
								{positions.length === 0 ? (
									<tr>
										<td colSpan={6}>
											<EmptyState
												title={t('dashboardCabinet.empty.noStakingPositions', {
													defaultValue: 'No staking positions yet',
												})}
											/>
										</td>
									</tr>
								) : (
									positions.map((row) => (
										<tr key={row.id}>
											<td>{row.id}</td>
											<td>{money(row.amount)}</td>
											<td>{(Number(row.dailyRate) * 100).toFixed(1)}%</td>
											<td>{money(row.earned)}</td>
											<td>{row.lockUntil ? new Date(row.lockUntil).toLocaleString() : '-'}</td>
											<td>
												<span
													className={`dash-badge ${String(row.status || '').toLowerCase() === 'completed' ? 'is-success' : 'is-info'}`}>
													{row.status}
												</span>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
			{confirmTier ? (
				<div className="auth-modal-backdrop" onClick={closeConfirm}>
					<div
						className="auth-modal-card topup-withdraw-modal"
						role="dialog"
						aria-modal="true"
						onClick={(e) => e.stopPropagation()}>
						<h3 className="auth-modal-title">
							{t('dashboardCabinet.staking.confirmTitle', {
								defaultValue: 'Confirm staking investment',
							})}
						</h3>
						<label className="d-block mb-2">
							{t('dashboardCabinet.table.amount', { defaultValue: 'Amount' })}
						</label>
						<input
							className="dash-input form-control mb-2"
							type="number"
							min={confirmTier.minAmount}
							max={confirmTier.maxAmount}
							step="0.01"
							value={confirmAmount}
							onChange={(e) => setConfirmAmount(e.target.value)}
						/>
						<div className="dash-state-card mb-3">
							<h6 className="mb-2">
								{t('dashboardCabinet.staking.subscriptionDetails', {
									defaultValue: 'Subscription details',
								})}
							</h6>
							<ul className="list-unstyled small mb-0" style={{ lineHeight: 1.65 }}>
								<li>
									<strong>
										{t('dashboardCabinet.staking.confirmDailyRate', {
											defaultValue: 'Daily rate (fixed for this position)',
										})}
									</strong>{' '}
									{(Number(confirmTier.dailyRate || 0) * 100).toFixed(2)}%{' '}
									{t('dashboardCabinet.staking.perDay', { defaultValue: 'per day' })}
								</li>
								<li>
									<strong>
										{t('dashboardCabinet.staking.confirmApr', {
											defaultValue: 'APR (simple, illustrative)',
										})}
									</strong>{' '}
									{simpleAprPercent.toFixed(1)}% ({' '}
									{t('dashboardCabinet.staking.aprHint', {
										defaultValue: 'daily × 365; not compound',
									})}
									)
								</li>
								<li>
									<strong>
										{t('dashboardCabinet.staking.confirmTerm', { defaultValue: 'Term' })}
									</strong>
									:{' '}
									{t('dashboardCabinet.staking.defaultTerm', {
										defaultValue: '30 days (1 month)',
									})}
								</li>
								<li>
									<strong>
										{t('dashboardCabinet.staking.confirmStartDate', {
											defaultValue: 'Start date',
										})}
									</strong>
									: {confirmSchedule ? confirmSchedule.start.toLocaleString() : '—'}
								</li>
								<li>
									<strong>
										{t('dashboardCabinet.staking.confirmEndDate', {
											defaultValue: 'End date (principal unlock)',
										})}
									</strong>
									<span className="dash-end-date-highlight">
										<FiCheckCircle className="me-1" aria-hidden style={{ verticalAlign: 'text-bottom' }} />
										{confirmSchedule ? confirmSchedule.end.toLocaleString() : '—'}
									</span>
								</li>
								<li>
									<strong>
										{t('dashboardCabinet.staking.projected30d', {
											defaultValue: 'Projected dividends (term)',
										})}
									</strong>
									: {money(projectedDividends30d || 0)}
								</li>
								<li>
									<strong>
										{t('dashboardCabinet.staking.projectedPayoutAtEnd', {
											defaultValue: 'Total projected at end date (principal + dividends)',
										})}
									</strong>
									: {money(projectedTotalAtEnd || 0)}
								</li>
								<li className="mt-2">
									<strong>
										{t('dashboardCabinet.staking.payoutSchedule', { defaultValue: 'Payout schedule' })}
									</strong>
									:{' '}
									{t('dashboardCabinet.staking.payoutScheduleValue', {
										defaultValue:
											'Rewards accrue hourly to your main USDT balance. Principal is unlocked after the end date.',
									})}
								</li>
							</ul>
							<p className="dash-help mt-3 mb-0">
								{t('dashboardCabinet.staking.termsShort', {
									defaultValue:
										'This rate applies only to this new position. If tier rates change later, your open position keeps the rate shown above. Figures are estimates, not guaranteed returns.',
								})}
							</p>
						</div>
						<p className="dash-alert is-warning">
							{t('dashboardCabinet.staking.lockNotice', {
								defaultValue:
									'Important: principal amount is locked for 30 days. Dividends are credited to your main balance and stay available for normal use.',
							})}
						</p>
						<div className="dash-actions-cell">
							<button
								className="dash-btn is-secondary is-sm"
								type="button"
								onClick={closeConfirm}
								disabled={submittingTierId === confirmTier.id}>
								{t('dashboardCabinet.actions.back', { defaultValue: 'Back' })}
							</button>
							<button
								className="dash-btn is-primary"
								type="button"
								onClick={confirmInvest}
								disabled={submittingTierId === confirmTier.id}>
								{submittingTierId === confirmTier.id
									? t('dashboardCabinet.actions.submitting', { defaultValue: 'Submitting...' })
									: t('dashboardCabinet.staking.confirmInvest', {
											defaultValue: 'Confirm investment',
										})}
							</button>
						</div>
					</div>
				</div>
			) : null}
			{resultOpen ? (
				<div className="auth-result-backdrop">
					<div className="auth-result-card" role="alertdialog" aria-modal="true">
						<div className="auth-result-icon is-error" aria-hidden="true">
							!
						</div>
						<h4>{t('auth.result.errorTitle')}</h4>
						<p>{resultMessage}</p>
						<button type="button" className="btn btn-info text-white" onClick={closeResult}>
							{t('auth.result.ok')}
						</button>
					</div>
				</div>
			) : null}
		</>
	);
}
