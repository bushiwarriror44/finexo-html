import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api/client";
import { useTranslation } from "react-i18next";
import { copyTextWithFeedback, formatLastUpdatedLabel, getSafeErrorMessage, money } from "./utils";
import { FiCheckCircle, FiCreditCard, FiDollarSign, FiLock, FiTrendingUp, FiUserCheck } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { ActionPopupCard } from "../../components/dashboard/ActionPopupCard";

export function DashboardOverviewPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [withdrawableBalance, setWithdrawableBalance] = useState(0);
  const [referral, setReferral] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [miningSummary, setMiningSummary] = useState(null);
  const [activeSessions] = useState(Number(window.localStorage.getItem("cm_security_active_sessions") || "1"));
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [overviewSyncAt, setOverviewSyncAt] = useState("");
  const [copyToastVisible, setCopyToastVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [balanceData, referralData, kycData, summaryData] = await Promise.all([
        apiGet("/api/user/balance"),
        apiGet("/api/user/referral"),
        apiGet("/api/user/kyc"),
        apiGet("/api/user/mining/summary"),
      ]);
      setBalance(Number(balanceData.balance || 0));
      setAvailableBalance(Number(balanceData.availableBalance || 0));
      setWithdrawableBalance(Number(balanceData.withdrawableBalance || 0));
      setReferral(referralData || null);
      setKyc(kycData || null);
      setMiningSummary(summaryData || null);
      setOverviewSyncAt(new Date().toISOString());
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadOverview")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!kyc || !["review", "submitted", "pending"].includes(String(kyc.status || "").toLowerCase())) return undefined;
    const interval = setInterval(() => {
      load().catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [kyc, load]);

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(""), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!copyToastVisible) return undefined;
    const timer = setTimeout(() => setCopyToastVisible(false), 2200);
    return () => clearTimeout(timer);
  }, [copyToastVisible]);


  const kycStatus = String(kyc?.status || "not_started").toLowerCase();
  const kycStepLabel =
    kycStatus === "approved"
      ? t("dashboardCabinet.overview.kycApproved", { defaultValue: "Approved" })
      : kycStatus === "rejected"
      ? t("dashboardCabinet.overview.kycRejected", { defaultValue: "Rejected" })
      : kycStatus === "submitted" || kycStatus === "review"
      ? t("dashboardCabinet.overview.kycReview", { defaultValue: "Under review" })
      : t("dashboardCabinet.overview.kycNotStarted", { defaultValue: "Not started" });
  const referralAbsoluteLink = useMemo(() => {
    const raw = String(referral?.link || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    return `https://cloud-mine.com${path}`;
  }, [referral?.link]);

  return (
    <>
      {error ? <p className="dash-alert is-error">{error}</p> : null}
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading ? <p className="dash-muted">{t("dashboardCabinet.messages.loadingOverview")}</p> : null}
      
      <p className="dash-help">{t("dashboardCabinet.overview.hourlyUpdateHint", { defaultValue: "Mining earnings are updated hourly and displayed with 4 decimal precision." })}</p>
      <div className="dashboard-trust-strip">
        <div className="dashboard-trust-strip-item">
          <strong>{t("dashboardCabinet.trust.verification", { defaultValue: "Verification level" })}</strong>
          <span>{kycStepLabel}</span>
        </div>
        <div className="dashboard-trust-strip-item">
          <strong>{t("dashboardCabinet.trust.withdrawPolicy", { defaultValue: "Withdrawal policy" })}</strong>
          <span>{kyc?.verificationRequested && kycStatus !== "approved" ? t("dashboardCabinet.trust.policyFreeze", { defaultValue: "Policy freeze" }) : t("dashboardCabinet.trust.normal", { defaultValue: "Normal" })}</span>
        </div>
        <div className="dashboard-trust-strip-item">
          <strong>{t("dashboardCabinet.trust.finality", { defaultValue: "Finality" })}</strong>
          <span>{t("dashboardCabinet.trust.onchainRequired", { defaultValue: "On-chain confirmation" })}</span>
        </div>
        <div className="dashboard-trust-strip-item">
          <strong>{t("dashboardCabinet.trust.sync", { defaultValue: "Sync" })}</strong>
          <span>{formatLastUpdatedLabel(overviewSyncAt, t, { withRelativeHint: false })}</span>
        </div>
      </div>
      <div className="dashboard-priority-grid dashboard-priority-grid-compact">
        <div className="dashboard-priority-card">
          <strong>{t("dashboardCabinet.overview.profileIdentity", { defaultValue: "Identity" })}</strong>
          <span>{[user?.first_name, user?.last_name].filter(Boolean).join(" ") || t("dashboardCabinet.overview.notSet", { defaultValue: "Not set" })}</span>
        </div>
        <div className="dashboard-priority-card">
          <strong>{t("dashboardCabinet.overview.residenceCountry", { defaultValue: "Residence country" })}</strong>
          <span>{user?.country_code || t("dashboardCabinet.overview.notSet", { defaultValue: "Not set" })}</span>
        </div>
        <div className="dashboard-priority-card">
          <strong>{t("dashboardCabinet.overview.sessionState", { defaultValue: "Session state" })}</strong>
          <span>{activeSessions > 1 ? t("dashboardCabinet.overview.multiSession", { defaultValue: "Multiple sessions" }) : t("dashboardCabinet.overview.singleSession", { defaultValue: "Single session" })}</span>
        </div>
      </div>
      <div className="dashboard-grid dashboard-grid-5">
        <article className="dashboard-panel metric-card is-primary is-accent">
          <FiCreditCard className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.totalBalance", { defaultValue: t("dashboardCabinet.metrics.balance") })}</p>
          <h4 className="metric-value">{money(balance)}</h4>
          <small className="dash-help">
            {t("dashboardCabinet.metrics.balanceIncludesBonus", { defaultValue: "Including bonus tokens" })}
            {" · "}
            {t("dashboardCabinet.metrics.withdrawableDiffHint", { defaultValue: "May differ from withdrawable amount" })}
          </small>
        </article>
        <article className="dashboard-panel metric-card">
          <FiDollarSign className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.withdrawable", { defaultValue: "К выводу" })}</p>
          <h4 className="metric-value">{money(withdrawableBalance)}</h4>
          <small className="dash-help">{t("dashboardCabinet.withdrawals.profitOnlyWithdrawableHint", { defaultValue: "Only profit/withdrawable balance can be withdrawn." })}</small>
        </article>
        <article className="dashboard-panel metric-card">
          <FiLock className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.available")}</p>
          <h4 className="metric-value">{money(availableBalance)}</h4>
        </article>
        <article className="dashboard-panel metric-card is-muted">
          <FiUserCheck className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.activeContracts")}</p>
          <h4 className="metric-value">{Number(miningSummary?.activeContracts || 0)}</h4>
        </article>
        <article className="dashboard-panel metric-card">
          <FiTrendingUp className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.miningEarned")}</p>
          <h4 className="metric-value">{money(miningSummary?.totalEarnedUsdt || 0)}</h4>
        </article>
      </div>

      <div className="dashboard-grid dashboard-grid-2" id="overview-referral">
        <div className="dashboard-panel is-accent">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.overview.referralTitle")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.overview.referralHint", { defaultValue: "Use a single active referral code to keep tracking consistent." })}</p>
            <p><strong>{t("dashboardCabinet.overview.yourCode")}:</strong> {referral?.code || "-"}</p>
            <p>
              <strong>{t("dashboardCabinet.overview.link")}:</strong>{" "}
              {referralAbsoluteLink ? (
                <button
                  type="button"
                  className="dash-ref-link-btn"
                  onClick={async () => {
                    const ok = await copyTextWithFeedback(referralAbsoluteLink, {
                      onSuccess: () => setCopyToastVisible(true),
                      onError: () => setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." })),
                    });
                    if (!ok) setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." }));
                  }}
                >
                  {referralAbsoluteLink}
                </button>
              ) : "-"}
            </p>
            <div className="dash-actions-cell">
              <button
                className="dash-btn is-secondary is-sm"
                type="button"
                onClick={async () => {
                  const ok = await copyTextWithFeedback(referral?.code || "", {
                    onSuccess: () => setStatus(t("dashboardCabinet.actions.copied", { defaultValue: "Copied" })),
                    onError: () => setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." })),
                  });
                  if (!ok) setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." }));
                }}
              >
                {t("dashboardCabinet.actions.copyCode", { defaultValue: "Copy code" })}
              </button>
              <button
                className="dash-btn is-secondary is-sm"
                type="button"
                onClick={async () => {
                  const ok = await copyTextWithFeedback(referralAbsoluteLink || "", {
                    onSuccess: () => setCopyToastVisible(true),
                    onError: () => setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." })),
                  });
                  if (!ok) setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." }));
                }}
              >
                {t("dashboardCabinet.actions.copyLink", { defaultValue: "Copy link" })}
              </button>
            </div>
            <p>
              <strong>{t("dashboardCabinet.overview.invites")}:</strong> {t("dashboardCabinet.overview.invitesDirect", { defaultValue: "Прямые" })}{" "}
              {referral?.invitesByLevel?.["1"] || 0}, {t("dashboardCabinet.overview.invitesSecondLevel", { defaultValue: "Второй уровень" })}{" "}
              {referral?.invitesByLevel?.["2"] || 0}, {t("dashboardCabinet.overview.invitesThirdLevel", { defaultValue: "Третий уровень" })}{" "}
              {referral?.invitesByLevel?.["3"] || 0}
            </p>
            <button
              className="dash-btn is-secondary"
              type="button"
              onClick={async () => {
                setError("");
                setConfirmRegenerate(true);
              }}
            >
              {t("dashboardCabinet.overview.regenerateCode")}
            </button>
            {confirmRegenerate ? (
              <div className="dash-inline-confirm">
                <p>{t("dashboardCabinet.overview.regenerateConfirm", { defaultValue: "Regenerate referral code? Previous links may stop working." })}</p>
                <div className="dash-inline-confirm-actions">
                  <button className="dash-btn is-danger-ghost is-sm" type="button" onClick={() => setConfirmRegenerate(false)}>
                    {t("dashboardCabinet.actions.cancel", { defaultValue: "Cancel" })}
                  </button>
                  <button
                    className="dash-btn is-secondary is-sm"
                    type="button"
                    onClick={async () => {
                      try {
                        await apiPost("/api/user/referral/regenerate", {});
                        setConfirmRegenerate(false);
                        await load();
                        setStatus(t("dashboardCabinet.messages.saved", { defaultValue: "Changes saved." }));
                      } catch (err) {
                        setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.regenerateCodeFailed")));
                      }
                    }}
                  >
                    {t("dashboardCabinet.actions.confirm", { defaultValue: "Confirm" })}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {copyToastVisible ? (
        <div className="dash-copy-toast" role="status" aria-live="polite">
          <FiCheckCircle />
          <span>Скопировано успешно</span>
        </div>
      ) : null}
    </>
  );
}
