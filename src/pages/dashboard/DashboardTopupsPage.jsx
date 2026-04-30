import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../api/client";
import { useTranslation } from "react-i18next";
import { copyTextWithFeedback, formatDateTimeRu, formatLastUpdatedLabel, getSafeErrorMessage, normalizeApiList, shortenHash, statusBadgeClass } from "./utils";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { TopupModal } from "../../components/dashboard/TopupModal";
import { FiAlertTriangle, FiClock, FiFilter, FiShield } from "react-icons/fi";

export function DashboardTopupsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [wallets, setWallets] = useState([]);
  const [topups, setTopups] = useState([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("id_desc");
  const [quickFilter, setQuickFilter] = useState("all");
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [copiedHash, setCopiedHash] = useState("");
  const [topupsSyncAt, setTopupsSyncAt] = useState("");
  const [expandedTopupId, setExpandedTopupId] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState([]);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const didInitRef = useRef(false);

  const selectedWallet = useMemo(
    () => wallets.find((item) => item.asset === "USDT" && item.network === "TRX") || null,
    [wallets]
  );
  const supportedWallets = useMemo(
    () => wallets.filter((item) => item.asset === "USDT" && item.network === "TRX"),
    [wallets]
  );
  const filteredTopups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = topups.filter((item) => {
      const normalizedStatus = String(item.status || "").toLowerCase();
      if (quickFilter === "pending" && !["pending", "processing"].includes(normalizedStatus)) return false;
      if (quickFilter === "failed" && normalizedStatus !== "failed") return false;
      if (quickFilter === "completed" && !["completed", "done", "success"].includes(normalizedStatus)) return false;
      if (!term) return true;
      return [item.asset, item.network, item.status, item.verificationStatus, item.txHash]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
    return list.sort((a, b) => {
      if (sortBy === "id_asc") return Number(a.id || 0) - Number(b.id || 0);
      if (sortBy === "amount_desc") return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortBy === "amount_asc") return Number(a.amount || 0) - Number(b.amount || 0);
      return Number(b.id || 0) - Number(a.id || 0);
    });
  }, [topups, search, sortBy, quickFilter]);

  const load = useCallback(async ({ silent = false, includeWallets = false, includePresets = false } = {}) => {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const query = new URLSearchParams();
      if (quickFilter !== "all") query.set("status", quickFilter);
      if (dateFrom) query.set("dateFrom", dateFrom);
      if (dateTo) query.set("dateTo", dateTo);
      if (amountMin) query.set("amountMin", amountMin);
      if (amountMax) query.set("amountMax", amountMax);
      const [topupData, walletData, presetData] = await Promise.all([
        apiGet(`/api/wallet/topups?${query.toString()}`),
        includeWallets ? apiGet("/api/wallet/addresses") : Promise.resolve(null),
        includePresets ? apiGet("/api/user/dashboard/filter-presets?scope=topups") : Promise.resolve(null),
      ]);
      setTopups(normalizeApiList(topupData));
      if (includeWallets) setWallets(normalizeApiList(walletData));
      if (includePresets) setPresets(Array.isArray(presetData) ? presetData : []);
      setTopupsSyncAt(new Date().toISOString());
    } catch (err) {
      if (!silent) setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadTopups")));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [amountMax, amountMin, dateFrom, dateTo, quickFilter, t]);

  useEffect(() => {
    const persistedSearch = window.localStorage.getItem("cm_topups_search");
    const persistedSort = window.localStorage.getItem("cm_topups_sort");
    if (persistedSearch) setTimeout(() => setSearch(persistedSearch), 0);
    if (persistedSort) setTimeout(() => setSortBy(persistedSort), 0);
    return undefined;
  }, []);
  useEffect(() => {
    if (didInitRef.current) return undefined;
    didInitRef.current = true;
    const timer = setTimeout(() => {
      load({ includeWallets: true, includePresets: true }).catch(() => {}).finally(() => setInitialLoaded(true));
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!didInitRef.current) return undefined;
    load({ silent: true }).catch(() => {});
    return undefined;
  }, [quickFilter, dateFrom, dateTo, amountMin, amountMax, load]);

  useEffect(() => {
    window.localStorage.setItem("cm_topups_search", search);
  }, [search]);

  useEffect(() => {
    window.localStorage.setItem("cm_topups_sort", sortBy);
  }, [sortBy]);

  useEffect(() => {
    const hasActiveTopups = topups.some((item) => ["queued", "running", "failed"].includes(item.verificationStatus));
    if (!hasActiveTopups) return undefined;
    const interval = setInterval(() => {
      load({ silent: true }).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [load, topups]);

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(""), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading && !initialLoaded ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-grid">
        <div className="dashboard-panel is-accent">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.topups.title")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.topups.preActionHint", { defaultValue: "Submit a valid TRON transaction hash to start USDT verification workflow." })}</p>
            <p className="dash-help">{t("dashboardCabinet.topups.disclosure", { defaultValue: "Funds are credited after blockchain confirmation and compliance checks." })}</p>
            <div className="dash-trust-strip is-info">
              <FiShield />
              <span>{t("dashboardCabinet.topups.trustStrip", { defaultValue: "Deposits are credited only after on-chain confirmation and compliance checks." })}</span>
            </div>
            {selectedWallet ? <p className="dash-help">{t("dashboardCabinet.topups.sendTo")}: {selectedWallet.address} (USDT / TRX)</p> : null}
            <button className="dash-btn is-primary" type="button" onClick={() => setShowTopupModal(true)}>
              {t("dashboardCabinet.topups.openModal", { defaultValue: "Open top-up modal" })}
            </button>
          </div>
        </div>
        <div className="dashboard-panel is-accent">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.topups.statusTitle")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.topups.tableHint", { defaultValue: "Track verification status, ETA, and provider notes before taking action." })}</p>
            <div className="dash-meta-row">
              <span className="dash-meta-badge is-info">
                <FiClock />
                {t("dashboardCabinet.topups.lastSync", { defaultValue: "Last sync" })}: {formatLastUpdatedLabel(topupsSyncAt, t)}
              </span>
            </div>
            <div className="dash-kpi-grid">
              <article className="dash-kpi-card"><strong>{t("dashboardCabinet.topups.pending", { defaultValue: "Pending" })}</strong><span>{filteredTopups.filter((x) => ["pending", "processing"].includes(String(x.status || "").toLowerCase())).length}</span></article>
              <article className="dash-kpi-card is-secondary"><strong>{t("dashboardCabinet.topups.failed", { defaultValue: "Failed" })}</strong><span>{filteredTopups.filter((x) => String(x.status || "").toLowerCase() === "failed").length}</span></article>
              <article className="dash-kpi-card is-secondary"><strong>{t("dashboardCabinet.status.completed", { defaultValue: "Completed" })}</strong><span>{filteredTopups.filter((x) => ["completed", "done", "success"].includes(String(x.status || "").toLowerCase())).length}</span></article>
            </div>
            <div className="dash-trust-strip is-warning">
              <FiAlertTriangle />
              <span>{t("dashboardCabinet.topups.finalityStrip", { defaultValue: "After confirmation and posting, reversal is not guaranteed. Verify tx hash and destination before submission." })}</span>
            </div>
            <div className="dash-table-toolbar">
              <button className="dash-btn is-secondary is-sm" type="button" onClick={() => setShowFiltersModal(true)}>
                <FiFilter /> {t("dashboardCabinet.actions.filters", { defaultValue: "Filters" })}
              </button>
            </div>
            <div className="dashboard-grid dashboard-grid-5">
              <input type="date" className="dash-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <input type="date" className="dash-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <input className="dash-input" placeholder={t("dashboardCabinet.filters.amountMin", { defaultValue: "Amount min" })} value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
              <input className="dash-input" placeholder={t("dashboardCabinet.filters.amountMax", { defaultValue: "Amount max" })} value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
              <button className="dash-btn is-secondary is-sm" type="button" onClick={() => { setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax(""); setQuickFilter("all"); }}>
                {t("dashboardCabinet.actions.reset", { defaultValue: "Reset" })}
              </button>
            </div>
            <div className="dash-chip-row mt-2">
              <input className="dash-input" placeholder={t("dashboardCabinet.actions.savePreset", { defaultValue: "Save preset" })} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <button className="dash-btn is-secondary is-sm" type="button" onClick={async () => {
                if (!presetName.trim()) return;
                await apiPost("/api/user/dashboard/filter-presets", { scope: "topups", name: presetName.trim(), payload: { quickFilter, dateFrom, dateTo, amountMin, amountMax } });
                setPresetName("");
                await load({ includePresets: true, silent: true });
              }}>{t("dashboardCabinet.actions.save", { defaultValue: "Save" })}</button>
              <select className="dash-input dash-select-sm" defaultValue="" onChange={(e) => {
                const picked = presets.find((item) => String(item.id) === String(e.target.value));
                const payload = picked?.payload || {};
                setQuickFilter(payload.quickFilter || "all");
                setDateFrom(payload.dateFrom || "");
                setDateTo(payload.dateTo || "");
                setAmountMin(payload.amountMin || "");
                setAmountMax(payload.amountMax || "");
              }}>
                <option value="">{t("dashboardCabinet.savedPresets", { defaultValue: "Saved presets" })}</option>
                {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>ID</th><th>{t("dashboardCabinet.table.asset")}</th><th>{t("dashboardCabinet.table.network")}</th><th>{t("dashboardCabinet.table.amount")}</th><th>{t("dashboardCabinet.table.status")}</th><th>{t("dashboardCabinet.topups.verification")}</th><th>{t("dashboardCabinet.table.note")}</th><th>{t("dashboardCabinet.table.action")}</th></tr></thead>
                <tbody>
                  {filteredTopups.length === 0 ? (
                    <tr><td colSpan={8}><EmptyState title={t("dashboardCabinet.empty.noTopups")} actionLabel={t("dashboardCabinet.topups.openModal", { defaultValue: "Open top-up modal" })} onAction={() => setShowTopupModal(true)} /></td></tr>
                  ) : filteredTopups.map((topup) => (
                    <tr key={topup.id}>
                      <td data-label="ID">{topup.id}</td>
                      <td data-label={t("dashboardCabinet.table.asset")}>{topup.asset}</td>
                      <td data-label={t("dashboardCabinet.table.network")}>{topup.network}</td>
                      <td data-label={t("dashboardCabinet.table.amount")}>{topup.amount}</td>
                      <td data-label={t("dashboardCabinet.table.status")}><span className={statusBadgeClass(topup.status)}>{topup.status}</span></td>
                      <td data-label={t("dashboardCabinet.topups.verification")}><span className={statusBadgeClass(topup.verificationStatus)}>{topup.verificationStatus}</span></td>
                      <td data-label={t("dashboardCabinet.table.note")}>
                        <button
                          type="button"
                          className="dash-btn is-secondary is-sm"
                          onClick={() => setExpandedTopupId((prev) => (prev === topup.id ? null : topup.id))}
                        >
                          {expandedTopupId === topup.id
                            ? t("dashboardCabinet.actions.collapse", { defaultValue: "Hide details" })
                            : t("dashboardCabinet.actions.expand", { defaultValue: "Show details" })}
                        </button>
                        {expandedTopupId === topup.id ? (
                          <div className="dash-expandable-block">
                            <div className="dash-help">
                              {t("dashboardCabinet.topups.etaLabel", { defaultValue: "ETA" })}: {topup.verificationStatus === "running" ? t("dashboardCabinet.topups.etaValueRunning", { defaultValue: "~5-15 min" }) : t("dashboardCabinet.topups.etaValueIdle", { defaultValue: "settled/queued" })}
                            </div>
                            <div className="dash-help">
                              {t("dashboardCabinet.topups.feeLabel", { defaultValue: "Fee" })}: {topup.feeAmount ? `${topup.feeAmount} ${topup.asset || ""}` : t("dashboardCabinet.topups.feeNetworkDependent", { defaultValue: "network dependent" })}
                            </div>
                            <div className="dash-help">
                              {t("dashboardCabinet.topups.attempts", { defaultValue: "Verification attempts" })}: {Number(topup.attempts || 0)} | {t("dashboardCabinet.topups.nextRetry", { defaultValue: "Next retry" })}: {topup.nextRetryAt ? formatDateTimeRu(topup.nextRetryAt) : "-"}
                            </div>
                            <div className="dash-help">
                              {t("dashboardCabinet.topups.deadLetter", { defaultValue: "Dead letter" })}: {topup.isDeadLetter ? t("dashboardCabinet.status.enabled", { defaultValue: "Enabled" }) : t("dashboardCabinet.status.disabled", { defaultValue: "Disabled" })}
                            </div>
                            <div>{topup.providerNote || topup.lastErrorCode || shortenHash(topup.txHash)}</div>
                          </div>
                        ) : (
                          <div>{shortenHash(topup.txHash)}</div>
                        )}
                      </td>
                      <td data-label={t("dashboardCabinet.table.action")} className="dash-actions-cell">
                        {topup.txHash ? (
                          <>
                            <button className="dash-btn is-secondary is-sm" type="button" onClick={() => {
                              copyTextWithFeedback(topup.txHash || "", {
                                onSuccess: () => {
                                  setCopiedHash(topup.txHash || "");
                                  setStatus(t("dashboardCabinet.actions.copied", { defaultValue: "Copied" }));
                                },
                                onError: () => setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." })),
                              });
                            }}>
                              {copiedHash === topup.txHash ? t("dashboardCabinet.actions.copied", { defaultValue: "Copied" }) : t("dashboardCabinet.actions.copy", { defaultValue: "Copy" })}
                            </button>
                            <a className="dash-btn is-secondary is-sm" href={`https://www.blockchain.com/explorer/search?query=${encodeURIComponent(topup.txHash)}`} target="_blank" rel="noreferrer">
                              {t("dashboardCabinet.actions.explorer", { defaultValue: "Explorer" })}
                            </a>
                          </>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="dash-btn is-secondary is-sm dash-inline-btn" type="button" onClick={() => load({ includeWallets: true, includePresets: true }).catch(() => {})}>
              {t("dashboardCabinet.actions.retry")}
            </button>
          </div>
        </div>
      </div>
      <TopupModal
        isOpen={showTopupModal}
        wallets={supportedWallets}
        onClose={() => setShowTopupModal(false)}
        onSubmit={async (payload) => {
          try {
            const response = await apiPost("/api/wallet/topup", payload);
            setStatus(t("dashboardCabinet.messages.topupSubmitted"));
            await load({ silent: true });
            return response;
          } catch (err) {
            throw new Error(getSafeErrorMessage(err, t("dashboardCabinet.messages.topupSubmitFailed")), {
              cause: err,
            });
          }
        }}
        t={t}
      />
      {showFiltersModal ? (
        <div className="auth-modal-backdrop" onClick={() => setShowFiltersModal(false)}>
          <div className="auth-modal-card topup-withdraw-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="auth-modal-title">{t("dashboardCabinet.actions.filters", { defaultValue: "Filters" })}</h3>
            <div className="dash-chip-row mb-2">
              <button type="button" className={`dash-chip ${quickFilter === "all" ? "is-active" : ""}`} onClick={() => setQuickFilter("all")}>
                {t("dashboardCabinet.actions.all", { defaultValue: "All" })}
              </button>
              <button type="button" className={`dash-chip ${quickFilter === "pending" ? "is-active" : ""}`} onClick={() => setQuickFilter("pending")}>
                {t("dashboardCabinet.topups.pending", { defaultValue: "Pending" })}
              </button>
              <button type="button" className={`dash-chip ${quickFilter === "failed" ? "is-active" : ""}`} onClick={() => setQuickFilter("failed")}>
                {t("dashboardCabinet.topups.failed", { defaultValue: "Failed" })}
              </button>
              <button type="button" className={`dash-chip ${quickFilter === "completed" ? "is-active" : ""}`} onClick={() => setQuickFilter("completed")}>
                {t("dashboardCabinet.status.completed", { defaultValue: "Completed" })}
              </button>
            </div>
            <input
              className="dash-input mb-2"
              placeholder={t("dashboardCabinet.actions.search", { defaultValue: "Search..." })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="dash-input dash-select-sm mb-3" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="id_desc">{t("dashboardCabinet.actions.sortNewest", { defaultValue: "Newest first" })}</option>
              <option value="id_asc">{t("dashboardCabinet.actions.sortOldest", { defaultValue: "Oldest first" })}</option>
              <option value="amount_desc">{t("dashboardCabinet.actions.sortAmountDesc", { defaultValue: "Amount: high to low" })}</option>
              <option value="amount_asc">{t("dashboardCabinet.actions.sortAmountAsc", { defaultValue: "Amount: low to high" })}</option>
            </select>
            <div className="dash-actions-cell">
              <button className="dash-btn is-secondary is-sm" type="button" onClick={() => setShowFiltersModal(false)}>
                {t("dashboardCabinet.actions.close", { defaultValue: "Close" })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
