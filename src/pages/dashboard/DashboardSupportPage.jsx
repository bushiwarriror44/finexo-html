import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../api/client';
import { useTranslation } from 'react-i18next';
import { formatDateTimeRu, formatLastUpdatedLabel, getSafeErrorMessage, normalizeApiList, statusBadgeClass } from './utils';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/dashboard/StateBlocks';

export function DashboardSupportPage() {
	const { t } = useTranslation();
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');
	const [tickets, setTickets] = useState([]);
	const [ticketSubject, setTicketSubject] = useState('');
	const [ticketPriority, setTicketPriority] = useState('medium');
	const [ticketCategory, setTicketCategory] = useState('general');
	const [ticketMessage, setTicketMessage] = useState('');
	const [ticketAttachment, setTicketAttachment] = useState(null);
	const [activeTicketId, setActiveTicketId] = useState(null);
	const [messages, setMessages] = useState([]);
	const [newMessage, setNewMessage] = useState('');
	const [search, setSearch] = useState('');
	const [nowTs, setNowTs] = useState(() => Date.now());
	const [supportSyncAt, setSupportSyncAt] = useState('');
	const [expandedTicketId, setExpandedTicketId] = useState(null);
	const [statusFilter, setStatusFilter] = useState('all');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo, setDateTo] = useState('');
	const [presetName, setPresetName] = useState('');
	const [presets, setPresets] = useState([]);
	const [supportTraces, setSupportTraces] = useState([]);
	const [initialLoaded, setInitialLoaded] = useState(false);

	const loadTickets = useCallback(async ({ silent = false } = {}) => {
		if (!silent) {
			setLoading(true);
			setError('');
		}
		try {
			const query = new URLSearchParams();
			if (statusFilter !== 'all') query.set('status', statusFilter);
			if (dateFrom) query.set('dateFrom', dateFrom);
			if (dateTo) query.set('dateTo', dateTo);
			const [data, presetData, traceData] = await Promise.all([
				apiGet(`/api/user/support/tickets?${query.toString()}`),
				apiGet('/api/user/dashboard/filter-presets?scope=support'),
				apiGet('/api/user/dashboard/audit-traces?scope=support'),
			]);
			setTickets(normalizeApiList(data));
			setPresets(Array.isArray(presetData) ? presetData : []);
			setSupportTraces(Array.isArray(traceData) ? traceData : []);
			setSupportSyncAt(new Date().toISOString());
			setInitialLoaded(true);
		} catch (err) {
			if (!silent) {
				setError(getSafeErrorMessage(err, t('dashboardCabinet.messages.failedLoadSupport')));
			}
		} finally {
			if (!silent) {
				setLoading(false);
			}
		}
	}, [dateFrom, dateTo, statusFilter, t]);

	const loadMessages = useCallback(async (ticketId) => {
		try {
			const data = await apiGet(`/api/user/support/tickets/${ticketId}/messages`);
			setMessages(normalizeApiList(data.messages));
		} catch (err) {
			if (err?.code === 'SUPPORT_TICKET_NOT_FOUND') {
				setActiveTicketId(null);
				setMessages([]);
				window.localStorage.removeItem('cm_support_active_ticket');
				await loadTickets();
				return;
			}
			setError(getSafeErrorMessage(err, t('dashboardCabinet.messages.failedLoadMessages')));
		}
	}, [loadTickets, t]);

	useEffect(() => {
		const persistedSearch = window.localStorage.getItem('cm_support_search');
		const persistedActiveTicket = window.localStorage.getItem('cm_support_active_ticket');
		if (persistedSearch) {
			setTimeout(() => setSearch(persistedSearch), 0);
		}
		if (persistedActiveTicket) {
			setTimeout(() => setActiveTicketId(Number(persistedActiveTicket)), 0);
		}
		const timer = setTimeout(() => {
			loadTickets().catch(() => {});
		}, 0);
		return () => clearTimeout(timer);
	}, [loadTickets]);

	useEffect(() => {
		window.localStorage.setItem('cm_support_search', search);
	}, [search]);

	useEffect(() => {
		const timer = setInterval(() => setNowTs(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!activeTicketId) return undefined;
		window.localStorage.setItem('cm_support_active_ticket', String(activeTicketId));
		const timer = setTimeout(() => {
			loadMessages(activeTicketId).catch(() => {});
		}, 0);
		const interval = setInterval(() => {
			loadMessages(activeTicketId).catch(() => {});
		}, 4000);
		return () => {
			clearTimeout(timer);
			clearInterval(interval);
		};
	}, [activeTicketId, loadMessages]);

	useEffect(() => {
		if (!activeTicketId) return;
		const exists = tickets.some((ticket) => Number(ticket.id) === Number(activeTicketId));
		if (exists) return;
		const timer = setTimeout(() => {
			setActiveTicketId(null);
			setMessages([]);
		}, 0);
		window.localStorage.removeItem('cm_support_active_ticket');
		return () => clearTimeout(timer);
	}, [activeTicketId, tickets]);

	useEffect(() => {
		if (!status) return undefined;
		const timer = setTimeout(() => setStatus(''), 3000);
		return () => clearTimeout(timer);
	}, [status]);

	const createTicket = async (e) => {
		e.preventDefault();
		setError('');
		if (!ticketSubject.trim() || !ticketMessage.trim()) {
			setError(t('dashboardCabinet.messages.invalidTicketForm'));
			return;
		}
		try {
			await apiPost('/api/user/support/tickets', {
				subject: ticketSubject,
				priority: ticketPriority,
				category: ticketCategory,
				message: ticketMessage,
			});
			setTicketSubject('');
			setTicketPriority('medium');
			setTicketCategory('general');
			setTicketMessage('');
			setTicketAttachment(null);
			setStatus(t('dashboardCabinet.support.ticketCreated', { defaultValue: 'Ticket created successfully.' }));
			await loadTickets({ silent: true });
		} catch (err) {
			setError(getSafeErrorMessage(err, t('dashboardCabinet.messages.ticketCreateFailed')));
		}
	};

	const sendMessage = async (e) => {
		e.preventDefault();
		if (!activeTicketId || !newMessage.trim()) return;
		setSending(true);
		try {
			const message = ticketAttachment
				? `${newMessage}\n[attachment: ${ticketAttachment.name}]`
				: newMessage;
			await apiPost(`/api/user/support/tickets/${activeTicketId}/messages`, { message });
			setNewMessage('');
			setTicketAttachment(null);
			setStatus(t('dashboardCabinet.support.messageSent', { defaultValue: 'Message sent.' }));
			await loadMessages(activeTicketId);
		} catch (err) {
			setError(getSafeErrorMessage(err, t('dashboardCabinet.messages.messageSendFailed')));
		} finally {
			setSending(false);
		}
	};

	const closeTicket = async (ticketId) => {
		const allowed = window.confirm(
			t('dashboardCabinet.support.closeTicketConfirm', {
				defaultValue: 'Close this ticket? You can open a new one later.',
			}),
		);
		if (!allowed) return;
		try {
			await apiPost(`/api/user/support/tickets/${ticketId}/close`, {});
			setStatus(t('dashboardCabinet.support.ticketClosed', { defaultValue: 'Ticket closed.' }));
			await loadTickets({ silent: true });
			if (activeTicketId === ticketId) setActiveTicketId(null);
		} catch (err) {
			setError(
				getSafeErrorMessage(
					err,
					t('dashboardCabinet.messages.ticketCloseFailed', {
						defaultValue: 'Could not close ticket',
					}),
				),
			);
		}
	};

	const visibleTickets = tickets.filter((ticket) => {
		const term = search.trim().toLowerCase();
		if (!term) return true;
		return [
			ticket.subject,
			ticket.status,
			ticket.slaState,
			ticket.priority,
			ticket.category,
			String(ticket.id),
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
			.includes(term);
	});

	const formatSlaBucket = (ticket) => {
		const fallbackDueAt = nowTs + 3600000;
		const dueAt = ticket.firstResponseDueAt ? new Date(ticket.firstResponseDueAt).getTime() : fallbackDueAt;
		const seconds = Math.max(0, Math.floor((dueAt - nowTs) / 1000));
		if (seconds <= 300) return t('dashboardCabinet.support.slaCritical', { defaultValue: 'critical < 5m' });
		if (seconds <= 1800) return t('dashboardCabinet.support.slaWarning', { defaultValue: 'warning < 30m' });
		return t('dashboardCabinet.support.slaStable', { defaultValue: 'on track' });
	};

	return (
		<>
			<ErrorState
				message={error}
				onRetry={() => loadTickets().catch(() => {})}
				retryLabel={t('dashboardCabinet.actions.retry')}
			/>
			{status ? <p className="dash-alert is-success">{status}</p> : null}
			{loading && !initialLoaded ? <LoadingSkeleton rows={3} /> : null}
			<div className="dashboard-grid dashboard-grid-2">
				<div className="dashboard-panel">
					<div className="dashboard-panel-header">
						<h5>{t('dashboardCabinet.support.ticketsTitle')}</h5>
					</div>
					<div className="dashboard-panel-body">
						<p className="dash-help">{t('dashboardCabinet.support.ticketsHint', { defaultValue: 'Create clear tickets to speed up triage and response.' })}</p>
						<div className="dash-meta-row">
							<span className="dash-meta-badge is-info">
								{t('dashboardCabinet.support.lastSync', { defaultValue: 'Last sync' })}: {formatLastUpdatedLabel(supportSyncAt, t)}
							</span>
						</div>
						<form className="dash-form" onSubmit={createTicket}>
							<input
								id="ticket-subject"
								className="dash-input"
								placeholder={t('dashboardCabinet.support.subject')}
								value={ticketSubject}
								onChange={(e) => setTicketSubject(e.target.value)}
							/>
							<select
								className="dash-input"
								value={ticketPriority}
								onChange={(e) => setTicketPriority(e.target.value)}>
								<option value="low">{t('dashboardCabinet.support.low')}</option>
								<option value="medium">{t('dashboardCabinet.support.medium')}</option>
								<option value="high">{t('dashboardCabinet.support.high')}</option>
							</select>
							<select
								className="dash-input"
								value={ticketCategory}
								onChange={(e) => setTicketCategory(e.target.value)}>
								<option value="general">
									{t('dashboardCabinet.support.categoryGeneral', { defaultValue: 'General' })}
								</option>
								<option value="payment">
									{t('dashboardCabinet.support.categoryPayment', { defaultValue: 'Payments' })}
								</option>
								<option value="technical">
									{t('dashboardCabinet.support.categoryTechnical', { defaultValue: 'Technical' })}
								</option>
								<option value="compliance">
									{t('dashboardCabinet.support.categoryCompliance', { defaultValue: 'Compliance' })}
								</option>
							</select>
							<textarea
								className="dash-input"
								rows={3}
								placeholder={t('dashboardCabinet.support.describeIssue')}
								value={ticketMessage}
								onChange={(e) => setTicketMessage(e.target.value)}
							/>
							<input
								className="dash-input"
								type="file"
								onChange={(e) => setTicketAttachment(e.target.files?.[0] || null)}
							/>
							<p className="dash-help">
								{t('dashboardCabinet.support.attachmentHint', {
									defaultValue: 'Attachment is filename-only: file is not uploaded yet and only filename is added to message text.',
								})}
							</p>
							<button className="dash-btn is-primary" type="submit">
								{t('dashboardCabinet.support.createTicket')}
							</button>
						</form>
						<input
							className="dash-input"
							placeholder={t('dashboardCabinet.actions.search', { defaultValue: 'Search...' })}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<div className="dashboard-grid dashboard-grid-5">
							<select className="dash-input dash-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
								<option value="all">{t('dashboardCabinet.actions.all', { defaultValue: 'All' })}</option>
								<option value="open">open</option>
								<option value="in_progress">in_progress</option>
								<option value="resolved">resolved</option>
								<option value="closed">closed</option>
							</select>
							<input type="date" className="dash-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
							<input type="date" className="dash-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
							<input className="dash-input" placeholder={t('dashboardCabinet.actions.savePreset', { defaultValue: 'Save preset' })} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
							<button className="dash-btn is-secondary is-sm" type="button" onClick={async () => {
								if (!presetName.trim()) return;
								await apiPost('/api/user/dashboard/filter-presets', { scope: 'support', name: presetName.trim(), payload: { statusFilter, dateFrom, dateTo } });
								setPresetName('');
								await loadTickets({ silent: true });
							}}>{t('dashboardCabinet.actions.save', { defaultValue: 'Save' })}</button>
						</div>
						<select className="dash-input dash-select-sm" defaultValue="" onChange={(e) => {
							const picked = presets.find((item) => String(item.id) === String(e.target.value));
							const payload = picked?.payload || {};
							setStatusFilter(payload.statusFilter || 'all');
							setDateFrom(payload.dateFrom || '');
							setDateTo(payload.dateTo || '');
						}}>
							<option value="">{t('dashboardCabinet.savedPresets', { defaultValue: 'Saved presets' })}</option>
							{presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
						</select>
						<div className="table-shell">
							<table className="dash-table">
								<thead>
									<tr>
										<th>ID</th>
										<th>{t('dashboardCabinet.support.subject')}</th>
										<th>{t('dashboardCabinet.table.status')}</th>
										<th>SLA</th>
										<th>{t('dashboardCabinet.table.action')}</th>
									</tr>
								</thead>
								<tbody>
									{visibleTickets.length === 0 ? (
										<tr>
											<td colSpan={5}>
												<EmptyState title={t('dashboardCabinet.empty.noTickets')} actionLabel={t('dashboardCabinet.support.createTicket', { defaultValue: 'Create ticket' })} onAction={() => document.getElementById('ticket-subject')?.focus()} />
											</td>
										</tr>
									) : (
										visibleTickets.map((ticket) => (
											<tr key={ticket.id}>
												<td data-label="ID">{ticket.id}</td>
												<td data-label={t('dashboardCabinet.support.subject')}>{ticket.subject}</td>
												<td data-label={t('dashboardCabinet.table.status')}>
													<span className={statusBadgeClass(ticket.status)}>{ticket.status}</span>
												</td>
												<td data-label="SLA">
													<span className={statusBadgeClass(ticket.slaState)}>
														{ticket.slaState}
													</span>
													<button
														type="button"
														className="dash-btn is-secondary is-sm"
														onClick={() => setExpandedTicketId((prev) => (prev === ticket.id ? null : ticket.id))}>
														{expandedTicketId === ticket.id
															? t('dashboardCabinet.actions.collapse', { defaultValue: 'Hide details' })
															: t('dashboardCabinet.actions.expand', { defaultValue: 'Show details' })}
													</button>
													{expandedTicketId === ticket.id ? (
														<div className="dash-expandable-block">
															<div className="dash-help">
																{t('dashboardCabinet.support.slaTimer', { defaultValue: 'SLA timer' })}: {formatSlaBucket(ticket)}
															</div>
															<div className="dash-help">
																{t('dashboardCabinet.table.note', { defaultValue: 'Note' })}: {ticket.category || '-'}
															</div>
															{(supportTraces || []).filter((trace) => Number(trace.entityId) === Number(ticket.id)).slice(0, 4).map((trace) => (
																<div key={trace.id} className="dash-help">
																	{trace.createdAt ? formatDateTimeRu(trace.createdAt) : '-'} | {trace.actorType}: {trace.event} {trace.details ? `- ${trace.details}` : ''}
																</div>
															))}
														</div>
													) : null}
												</td>
												<td data-label={t('dashboardCabinet.table.action')} className="dash-actions-cell">
													<button
														className="dash-btn is-secondary is-sm"
														type="button"
														onClick={() => setActiveTicketId(ticket.id)}>
														{t('dashboardCabinet.support.openTicket')}
													</button>
													{ticket.status !== 'closed' ? (
														<button
															className="dash-btn is-danger-ghost is-sm"
															type="button"
															onClick={() => closeTicket(ticket.id)}>
															{t('dashboardCabinet.support.closeTicket', { defaultValue: 'Close' })}
														</button>
													) : null}
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
				</div>
				<div className="dashboard-panel">
					<div className="dashboard-panel-header">
						<h5>
							{t('dashboardCabinet.support.chatTitle')} {activeTicketId ? `#${activeTicketId}` : ''}
						</h5>
					</div>
					<div className="dashboard-panel-body">
						<p className="dash-help">{t('dashboardCabinet.support.chatHint', { defaultValue: 'Use chat for updates tied to the selected ticket only.' })}</p>
						{!activeTicketId ? (
							<p className="dash-muted">{t('dashboardCabinet.support.selectTicket')}</p>
						) : (
							<>
								<div className="chat-shell">
									{messages.length === 0 ? (
										<p className="dash-muted">{t('dashboardCabinet.empty.noMessages')}</p>
									) : (
										messages.map((msg) => (
											<div key={msg.id} className="chat-row">
												<span className="chat-author">{msg.senderType}</span>
												<span className={statusBadgeClass(msg.eventType || 'processing')}>
													{msg.eventType || 'message'}
												</span>
												<p className="chat-body">{msg.body}</p>
											</div>
										))
									)}
								</div>
								<form className="dash-form chat-form" onSubmit={sendMessage}>
									<input
										className="dash-input"
										value={newMessage}
										onChange={(e) => setNewMessage(e.target.value)}
										placeholder={t('dashboardCabinet.support.typeMessage')}
									/>
									<input
										className="dash-input"
										type="file"
										onChange={(e) => setTicketAttachment(e.target.files?.[0] || null)}
									/>
									<p className="dash-help">
										{t('dashboardCabinet.support.filenameOnly', { defaultValue: 'Filename only mode: the file itself is not uploaded.' })}
									</p>
									<button className="dash-btn is-primary" type="submit" disabled={sending}>
										{sending
											? t('dashboardCabinet.actions.sending')
											: t('dashboardCabinet.actions.send')}
									</button>
								</form>
							</>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
