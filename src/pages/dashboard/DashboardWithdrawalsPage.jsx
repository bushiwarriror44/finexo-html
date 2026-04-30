import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../api/client";
import { useTranslation } from "react-i18next";
import { formatLastUpdatedLabel, getSafeErrorMessage, money, normalizeApiList, statusBadgeClass } from "./utils";
import { EmptyState, ErrorState, LoadingSkeleton } from "../../components/dashboard/StateBlocks";
import { WithdrawModal } from "../../components/dashboard/WithdrawModal";
import { FiAlertTriangle, FiClock, FiShield } from "react-icons/fi";

export function DashboardWithdrawalsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [withdrawals, setWithdrawals] = useState([]);
  const [withdrawableBalance, setWithdrawableBalance] = useState(0);
  const [purchaseOnlyBalance, setPurchaseOnlyBalance] = useState(0);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [addressBook, setAddressBook] = useState([]);
  const [savedAddress, setSavedAddress] = useState("");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawalsSyncAt, setWithdrawalsSyncAt] = useState("");
  const [kycFreezeActive, setKycFreezeActive] = useState(false);
  const [expandedWithdrawalId, setExpandedWithdrawalId] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState([]);
  const [risk, setRisk] = useState(null);
  const [withdrawalTraces, setWithdrawalTraces] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (quickFilter !== "all") query.set("status", quickFilter === "processing" ? "processing" : quickFilter);
      if (dateFrom) query.set("dateFrom", dateFrom);
      if (dateTo) query.set("dateTo", dateTo);
      if (amountMin) query.set("amountMin", amountMin);
      if (amountMax) query.set("amountMax", amountMax);
      const [balanceData, withdrawalData, kycData, presetData, tracesData] = await Promise.all([
        apiGet("/api/user/balance"),
        apiGet(`/api/user/withdrawals?${query.toString()}`),
        apiGet("/api/user/kyc"),
        apiGet("/api/user/dashboard/filter-presets?scope=withdrawals"),
        apiGet("/api/user/dashboard/audit-traces?scope=withdrawals"),
      ]);
      setWithdrawableBalance(balanceData.withdrawableBalance || 0);
      setPurchaseOnlyBalance(balanceData.purchaseOnlyBalance || 0);
      setWithdrawals(normalizeApiList(withdrawalData));
      const rawKyc = String(kycData?.rawStatus || kycData?.status || "not_started").toLowerCase();
      setKycFreezeActive(Boolean(kycData?.verificationRequested) && rawKyc !== "approved");
      setWithdrawalsSyncAt(new Date().toISOString());
      setPresets(Array.isArray(presetData) ? presetData : []);
      setWithdrawalTraces(Array.isArray(tracesData) ? tracesData : []);
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadWithdrawals")));
    } finally {
      setLoading(false);
    }
  }, [amountMax, amountMin, dateFrom, dateTo, quickFilter, t]);

  useEffect(() => {
    const persistedSearch = window.localStorage.getItem("cm_withdrawals_search");
    if (persistedSearch) setTimeout(() => setSearch(persistedSearch), 0);
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    try {
      const persisted = JSON.parse(window.localStorage.getItem("cm_withdraw_address_book") || "[]");
      if (Array.isArray(persisted)) setTimeout(() => setAddressBook(persisted), 0);
    } catch {
      setTimeout(() => setAddressBook([]), 0);
    }
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    window.localStorage.setItem("cm_withdrawals_search", search);
  }, [search]);

  const cancelWithdrawal = async (id) => {
    try {
      await apiPost(`/api/user/withdrawals/${id}/cancel`, {});
      setStatus(t("dashboardCabinet.messages.withdrawalCancelled", { defaultValue: "Withdrawal request cancelled." }));
      setConfirmCancelId(null);
      await load();
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.cancelFailed")));
    }
  };

  const saveAddress = () => {
    if (!withdrawAddress.trim()) return;
    const next = Array.from(new Set([withdrawAddress.trim(), ...addressBook])).slice(0, 5);
    setAddressBook(next);
    setSavedAddress(withdrawAddress.trim());
    window.localStorage.setItem("cm_withdraw_address_book", JSON.stringify(next));
  };

  const filteredWithdrawals = withdrawals.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    if (quickFilter === "pending" && status !== "pending") return false;
    if (quickFilter === "processing" && !["approved", "processing", "review"].includes(status)) return false;
    if (quickFilter === "completed" && status !== "completed") return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [row.asset, row.network, row.status, row.adminNote, String(row.id)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(""), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <>
      <ErrorState message={error} onRetry={() => load().catch(() => {})} retryLabel={t("dashboardCabinet.actions.retry")} />
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading ? <LoadingSkeleton rows={3} /> : null}
      <div className="dashboard-grid dashboard-grid-2">
        <div className="dashboard-panel is-accent">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.withdrawals.title")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.withdrawals.preActionHint", { defaultValue: "Verify network and address before submitting a withdrawal request." })}</p>
            <p className="dash-help">{t("dashboardCabinet.withdrawals.disclosure", { defaultValue: "Withdrawal requests are reviewed for security and compliance before execution." })}</p>
            {kycFreezeActive ? (
              <div className="dash-alert is-error">
                {t("dashboardCabinet.withdrawals.kycFreezeNotice", { defaultValue: "Withdrawals are temporarily frozen until KYC verification is approved by administrator." })}
              </div>
            ) : null}
            <div className="dash-trust-strip is-info">
              <FiShield />
              <span>{t("dashboardCabinet.withdrawals.trustStrip", { defaultValue: "Withdrawals pass security and compliance review before settlement." })}</span>
            </div>
            {addressBook.length ? (
              <select className="dash-input dash-select-sm" value={savedAddress} onChange={(e) => {
                setSavedAddress(e.target.value);
                setWithdrawAddress(e.target.value);
              }}>
                <option value="">{t("dashboardCabinet.withdrawals.savedAddresses", { defaultValue: "Saved addresses" })}</option>
                {addressBook.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : null}
            <input className="dash-input" value={withdrawAddress} onChange={(e) => setWithdrawAddress(e.target.value)} placeholder={t("dashboardCabinet.withdrawals.address")} />
            <button className="dash-btn is-secondary is-sm" type="button" onClick={saveAddress}>
              {t("dashboardCabinet.withdrawals.saveAddress", { defaultValue: "Save address" })}
            </button>
            <button className="dash-btn is-warning" type="button" onClick={async () => {
              try {
                const riskPayload = await apiPost("/api/user/withdrawals/risk-evaluate", {
                  amount: withdrawableBalance,
                  address: withdrawAddress,
                });
                setRisk(riskPayload);
              } catch {
                setRisk(null);
              }
              setShowWithdrawModal(true);
            }} disabled={kycFreezeActive}>
              {t("dashboardCabinet.withdrawals.openModal", { defaultValue: "Open withdrawal modal" })}
            </button>
            {risk ? (
              <div className={`dash-alert ${risk.tier === "high" ? "is-error" : risk.tier === "medium" ? "is-warning" : "is-success"}`}>
                {t("dashboardCabinet.withdrawals.riskTier", { defaultValue: "Risk tier" })}: {risk.tier} ({risk.score})
                <ul>
                  {(risk.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            ) : null}
            <p className="dash-help">{t("dashboardCabinet.withdrawals.available")}: {money(withdrawableBalance)}</p>
            <p className="dash-help">
              {t("dashboardCabinet.withdrawals.exactWithdrawable", { defaultValue: "Exact withdrawable amount" })}: {money(withdrawableBalance)}
            </p>
            <p className="dash-help">
              {t("dashboardCabinet.withdrawals.profitOnlyWithdrawableHint", { defaultValue: "Only profit/withdrawable balance can be withdrawn." })}
            </p>
            {Number(purchaseOnlyBalance || 0) > 0 ? (
              <p className="dash-help">
                {t("dashboardCabinet.withdrawals.bonusNonWithdrawable", { defaultValue: "Bonus tokens are not withdrawable and can only be used for buying power/tariffs." })} ({money(purchaseOnlyBalance)})
              </p>
            ) : null}
            <div className="dash-trust-strip is-warning">
              <FiAlertTriangle />
              <span>{t("dashboardCabinet.withdrawals.finalityStrip", { defaultValue: "Completed withdrawals are final. Double-check destination address before confirming." })}</span>
            </div>
            <div className="dashboard-trust-strip">
              <div className="dashboard-trust-strip-item">
                <strong>{t("dashboardCabinet.trust.verification", { defaultValue: "Verification level" })}</strong>
                <span>{kycFreezeActive ? t("dashboardCabinet.trust.review", { defaultValue: "Under review" }) : t("dashboardCabinet.trust.verifiedOrBasic", { defaultValue: "Verified / Basic" })}</span>
              </div>
              <div className="dashboard-trust-strip-item">
                <strong>{t("dashboardCabinet.trust.withdrawPolicy", { defaultValue: "Withdrawal policy" })}</strong>
                <span>{kycFreezeActive ? t("dashboardCabinet.trust.policyFreeze", { defaultValue: "Policy freeze" }) : t("dashboardCabinet.trust.normal", { defaultValue: "Normal" })}</span>
              </div>
              <div className="dashboard-trust-strip-item">
                <strong>{t("dashboardCabinet.trust.finality", { defaultValue: "Finality" })}</strong>
                <span>{t("dashboardCabinet.trust.finalizedAfterPosting", { defaultValue: "Finalized after posting" })}</span>
              </div>
              <div className="dashboard-trust-strip-item">
                <strong>{t("dashboardCabinet.trust.sync", { defaultValue: "Sync" })}</strong>
                <span>{formatLastUpdatedLabel(withdrawalsSyncAt, t, { withRelativeHint: false })}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="dashboard-panel is-accent">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.withdrawals.requests")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.withdrawals.tableHint", { defaultValue: "Use timeline and notes to understand current processing stage." })}</p>
            <div className="dash-meta-row">
              <span className="dash-meta-badge is-info">
                <FiClock />
                {t("dashboardCabinet.withdrawals.lastSync", { defaultValue: "Last sync" })}: {formatLastUpdatedLabel(withdrawalsSyncAt, t)}
              </span>
            </div>
            <input
              className="dash-input"
              placeholder={t("dashboardCabinet.actions.search", { defaultValue: "Search..." })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="dash-chip-row mt-2">
              <button type="button" className={`dash-chip ${quickFilter === "all" ? "is-active" : ""}`} onClick={() => setQuickFilter("all")}>
                {t("dashboardCabinet.actions.all", { defaultValue: "All" })}
              </button>
              <button type="button" className={`dash-chip ${quickFilter === "pending" ? "is-active" : ""}`} onClick={() => setQuickFilter("pending")}>
                {t("dashboardCabinet.status.pending", { defaultValue: "Pending" })}
              </button>
              <button type="button" className={`dash-chip ${quickFilter === "processing" ? "is-active" : ""}`} onClick={() => setQuickFilter("processing")}>
                {t("dashboardCabinet.status.processing", { defaultValue: "Processing" })}
              </button>
              <button type="button" className={`dash-chip ${quickFilter === "completed" ? "is-active" : ""}`} onClick={() => setQuickFilter("completed")}>
                {t("dashboardCabinet.status.completed", { defaultValue: "Completed" })}
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
                await apiPost("/api/user/dashboard/filter-presets", { scope: "withdrawals", name: presetName.trim(), payload: { quickFilter, dateFrom, dateTo, amountMin, amountMax } });
                setPresetName("");
                await load();
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
                <thead><tr><th>ID</th><th>{t("dashboardCabinet.table.asset")}</th><th>{t("dashboardCabinet.table.network")}</th><th>{t("dashboardCabinet.table.amount")}</th><th>{t("dashboardCabinet.table.status")}</th><th>{t("dashboardCabinet.table.note")}</th><th>{t("dashboardCabinet.table.action")}</th></tr></thead>
                <tbody>
                  {filteredWithdrawals.length === 0 ? (
                    <tr><td colSpan={7}><EmptyState title={t("dashboardCabinet.empty.noWithdrawals")} actionLabel={t("dashboardCabinet.topups.openModal", { defaultValue: "Open top-up modal" })} onAction={() => window.location.assign("/dashboard/topups")} /></td></tr>
                  ) : filteredWithdrawals.map((row) => (
                    <tr key={row.id}>
                      <td data-label="ID">{row.id}</td>
                      <td data-label={t("dashboardCabinet.table.asset")}>{row.asset}</td>
                      <td data-label={t("dashboardCabinet.table.network")}>{row.network}</td>
                      <td data-label={t("dashboardCabinet.table.amount")}>{row.amount}</td>
                      <td data-label={t("dashboardCabinet.table.status")}><span className={statusBadgeClass(row.status)}>{row.status}</span></td>
                      <td data-label={t("dashboardCabinet.table.note")}>
                        <button
                          type="button"
                          className="dash-btn is-secondary is-sm"
                          onClick={() => setExpandedWithdrawalId((prev) => (prev === row.id ? null : row.id))}
                        >
                          {expandedWithdrawalId === row.id
                            ? t("dashboardCabinet.actions.collapse", { defaultValue: "Hide details" })
                            : t("dashboardCabinet.actions.expand", { defaultValue: "Show details" })}
                        </button>
                        {expandedWithdrawalId === row.id ? (
                          <div className="dash-expandable-block">
                            <div className="withdraw-timeline">
                              <span className={String(row.status || "").toLowerCase() !== "pending" ? "is-done" : "is-active"}>
                                {t("dashboardCabinet.withdrawals.stageRequested", { defaultValue: "Requested" })}
                              </span>
                              <span className={["approved", "processing", "completed"].includes(String(row.status || "").toLowerCase()) ? "is-done" : ""}>
                                {t("dashboardCabinet.withdrawals.stageReview", { defaultValue: "Review" })}
                              </span>
                              <span className={String(row.status || "").toLowerCase() === "completed" ? "is-done" : ""}>
                                {t("dashboardCabinet.withdrawals.stageSettled", { defaultValue: "Settled" })}
                              </span>
                            </div>
                            <div className="dash-help">
                              {t("dashboardCabinet.withdrawals.etaLabel", { defaultValue: "ETA" })}: {["approved", "processing"].includes(String(row.status || "").toLowerCase()) ? t("dashboardCabinet.withdrawals.etaValue", { defaultValue: "up to 24h" }) : t("dashboardCabinet.withdrawals.etaNa", { defaultValue: "n/a" })} | {t("dashboardCabinet.withdrawals.feeLabel", { defaultValue: "Fee" })}: {row.feeAmount || t("dashboardCabinet.withdrawals.feeNetworkDependent", { defaultValue: "network dependent" })}
                            </div>
                            <div className="dash-help">
                              {t("dashboardCabinet.withdrawals.settlementStatus", { defaultValue: "Settlement status" })}: {row.status || "-"} | {t("dashboardCabinet.withdrawals.processedAt", { defaultValue: "Processed at" })}: {row.processedAt ? new Date(row.processedAt).toLocaleString() : "-"}
                            </div>
                            <div className="dash-help">
                              {t("dashboardCabinet.withdrawals.externalTx", { defaultValue: "External tx" })}: {row.externalTxHash || "-"}
                            </div>
                            {(withdrawalTraces || []).filter((trace) => Number(trace.entityId) === Number(row.id)).slice(0, 4).map((trace) => (
                              <div key={trace.id} className="dash-help">
                                {trace.createdAt ? new Date(trace.createdAt).toLocaleString() : "-"} | {trace.actorType}: {trace.event} {trace.details ? `- ${trace.details}` : ""}
                              </div>
                            ))}
                            {row.adminNote || "-"}
                          </div>
                        ) : (
                          <div>{row.adminNote || "-"}</div>
                        )}
                      </td>
                      <td data-label={t("dashboardCabinet.table.action")}>
                        {row.status === "pending" ? (
                          confirmCancelId === row.id ? (
                            <div className="dash-inline-confirm-actions">
                              <button className="dash-btn is-danger-ghost is-sm" type="button" onClick={() => setConfirmCancelId(null)}>
                                {t("dashboardCabinet.actions.keep", { defaultValue: "Keep" })}
                              </button>
                              <button className="dash-btn is-secondary is-sm" type="button" onClick={() => cancelWithdrawal(row.id)}>
                                {t("dashboardCabinet.actions.confirm", { defaultValue: "Confirm" })}
                              </button>
                            </div>
                          ) : (
                            <button className="dash-btn is-danger-ghost is-sm" type="button" onClick={() => setConfirmCancelId(row.id)}>
                              {t("dashboardCabinet.actions.cancel")}
                            </button>
                          )
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <WithdrawModal
        isOpen={showWithdrawModal}
        withdrawableBalance={withdrawableBalance}
        purchaseOnlyBalance={purchaseOnlyBalance}
        initialAddress={withdrawAddress}
        onClose={() => setShowWithdrawModal(false)}
        onSubmit={async (payload) => {
          await apiPost("/api/user/withdrawals", payload);
          setStatus(t("dashboardCabinet.messages.withdrawalSubmitted"));
          await load();
        }}
        t={t}
      />
    </>
  );
}
