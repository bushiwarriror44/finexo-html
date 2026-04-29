import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPostForm } from "../../api/client";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { copyTextWithFeedback, formatLastUpdatedLabel, getSafeErrorMessage, money } from "./utils";
import { FiCheckCircle, FiClock, FiCreditCard, FiDollarSign, FiLock, FiShield, FiTrendingUp, FiUserCheck } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { ActionPopupCard } from "../../components/dashboard/ActionPopupCard";
import { getPasswordStrength } from "../../utils/passwordStrength";

export function DashboardOverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [heldBalance, setHeldBalance] = useState(0);
  const [referral, setReferral] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [miningSummary, setMiningSummary] = useState(null);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [kycCountry, setKycCountry] = useState("");
  const [kycFile, setKycFile] = useState(null);
  const [kycDocType, setKycDocType] = useState("id_card");
  const [kycDragActive, setKycDragActive] = useState(false);
  const [kycWizardStep, setKycWizardStep] = useState(1);
  const [security2fa, setSecurity2fa] = useState(window.localStorage.getItem("cm_security_2fa") === "enabled");
  const [stepUp, setStepUp] = useState(window.localStorage.getItem("cm_security_stepup") === "enabled");
  const [lastLoginAt] = useState(window.localStorage.getItem("cm_security_last_login") || new Date().toISOString());
  const [activeSessions] = useState(Number(window.localStorage.getItem("cm_security_active_sessions") || "1"));
  const [securityEvents] = useState(() => {
    const items = [
      {
        id: "session",
        label: t("dashboardCabinet.overview.securityLogSession", { defaultValue: "Session authenticated" }),
        createdAt: new Date().toISOString(),
      },
      {
        id: "kyc",
        label: t("dashboardCabinet.overview.securityLogKyc", { defaultValue: "KYC status synchronized" }),
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      },
    ];
    return items;
  });
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [overviewSyncAt, setOverviewSyncAt] = useState("");
  const [overviewSection, setOverviewSection] = useState("activity");
  const [securitySettings, setSecuritySettings] = useState(null);
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [sessions, setSessions] = useState([]);
  const [kycTraces, setKycTraces] = useState([]);
  const kycWizardStorageKey = `cm_kyc_wizard_step_${user?.id || "guest"}`;
  const newPasswordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [balanceData, referralData, kycData, summaryData, secData, sessionData, kycTraceData] = await Promise.all([
        apiGet("/api/user/balance"),
        apiGet("/api/user/referral"),
        apiGet("/api/user/kyc"),
        apiGet("/api/user/mining/summary"),
        apiGet("/api/user/security/settings"),
        apiGet("/api/user/security/sessions"),
        apiGet("/api/user/dashboard/audit-traces?scope=kyc"),
      ]);
      setBalance(Number(balanceData.balance || 0));
      setAvailableBalance(Number(balanceData.availableBalance || 0));
      setHeldBalance(Number(balanceData.heldBalance || 0));
      setReferral(referralData || null);
      setKyc(kycData || null);
      setMiningSummary(summaryData || null);
      setSecuritySettings(secData || null);
      setSecurity2fa(Boolean(secData?.twoFactorEnabled));
      setStepUp(Boolean(secData?.stepUpRequired));
      setSessions(Array.isArray(sessionData) ? sessionData : []);
      setKycTraces(Array.isArray(kycTraceData) ? kycTraceData : []);
      setOverviewSyncAt(new Date().toISOString());
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadOverview")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  useEffect(() => {
    if (!kyc || !["review", "submitted", "pending"].includes(String(kyc.status || "").toLowerCase())) return undefined;
    const interval = setInterval(() => {
      load().catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [kyc]);

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(""), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const savedStep = Number(window.localStorage.getItem(kycWizardStorageKey) || "1");
    if (savedStep >= 1 && savedStep <= 4) {
      setKycWizardStep(savedStep);
    }
  }, [kycWizardStorageKey]);

  useEffect(() => {
    const sectionIds = ["overview-activity", "overview-referral", "overview-kyc", "overview-security"];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) return;
        const id = String(visible.target.id || "").replace("overview-", "");
        if (id) setOverviewSection(id);
      },
      { rootMargin: "-40% 0px -45% 0px", threshold: [0.15, 0.45] }
    );
    sectionIds.forEach((id) => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  const submitPassword = async (e) => {
    e.preventDefault();
    setError("");
    setStatus("");
    if (!newPasswordStrength.checks.minLength || !newPasswordStrength.checks.hasUppercase || !newPasswordStrength.checks.hasDigit) {
      setError(t("auth.passwordPolicyHint", { defaultValue: "Password must contain at least 8 characters, 1 uppercase letter, and 1 digit." }));
      return;
    }
    try {
      await apiPost("/api/user/change-password", { oldPassword, newPassword });
      setStatus(t("dashboardCabinet.messages.passwordUpdated"));
      setOldPassword("");
      setNewPassword("");
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.passwordUpdateFailed")));
    }
  };

  const submitKyc = async (e) => {
    e.preventDefault();
    if (kycWizardStep < 4) {
      if (kycWizardStep === 1 && !String(kycCountry || "").trim()) {
        setError(t("dashboardCabinet.overview.kycCountryRequired", { defaultValue: "Select country before continuing." }));
        return;
      }
      if (kycWizardStep === 2 && !String(kycDocType || "").trim()) {
        setError(t("dashboardCabinet.overview.kycDocTypeRequired", { defaultValue: "Select document type before continuing." }));
        return;
      }
      if (kycWizardStep === 3 && !kycFile) {
        setError(t("dashboardCabinet.messages.selectKycDocument"));
        return;
      }
      setError("");
      setKycWizardStep((prev) => Math.min(prev + 1, 4));
      return;
    }
    if (!kycFile) {
      setError(t("dashboardCabinet.messages.selectKycDocument"));
      return;
    }
    const maxBytes = 8 * 1024 * 1024;
    const allowed = new Set(["image/jpeg", "image/png", "application/pdf"]);
    if (!allowed.has(kycFile.type)) {
      setError(t("dashboardCabinet.overview.kycUnsupportedType", { defaultValue: "Unsupported file type. Use JPG, PNG, or PDF." }));
      return;
    }
    if (kycFile.size > maxBytes) {
      setError(t("dashboardCabinet.overview.kycFileTooLarge", { defaultValue: "File is too large. Max 8 MB." }));
      return;
    }
    setError("");
    setStatus("");
    const formData = new FormData();
    formData.append("country", kycCountry);
    formData.append("docType", kycDocType);
    formData.append("document", kycFile);
    try {
      await apiPostForm("/api/user/kyc/submit", formData);
      setStatus(t("dashboardCabinet.messages.kycSubmitted"));
      setKycFile(null);
      setKycDragActive(false);
      setKycWizardStep(1);
      await load();
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.kycSubmitFailed")));
    }
  };

  const kycStatus = String(kyc?.status || "not_started").toLowerCase();
  const workflowStep =
    kycStatus === "not_started"
      ? 1
      : Number(miningSummary?.activeContracts || 0) === 0
      ? 2
      : Number(availableBalance || 0) === 0
      ? 3
      : 4;
  const kycStepLabel =
    kycStatus === "approved"
      ? t("dashboardCabinet.overview.kycApproved", { defaultValue: "Approved" })
      : kycStatus === "rejected"
      ? t("dashboardCabinet.overview.kycRejected", { defaultValue: "Rejected" })
      : kycStatus === "submitted" || kycStatus === "review"
      ? t("dashboardCabinet.overview.kycReview", { defaultValue: "Under review" })
      : t("dashboardCabinet.overview.kycNotStarted", { defaultValue: "Not started" });
  const kycWizardCompletion = Math.round(
    ((kycCountry ? 1 : 0) + (kycDocType ? 1 : 0) + (kycFile ? 1 : 0) + (kycWizardStep >= 4 ? 1 : 0)) / 4 * 100
  );
  const kycMaxUnlockedStep = kycFile ? 4 : kycDocType ? 3 : kycCountry ? 2 : 1;
  const kycVerificationBadge =
    kycStatus === "approved"
      ? { key: "success", label: t("dashboardCabinet.overview.kycLevelVerified", { defaultValue: "Verification: Verified" }) }
      : kycStatus === "rejected"
      ? { key: "danger", label: t("dashboardCabinet.overview.kycLevelRejected", { defaultValue: "Verification: Rejected" }) }
      : kycStatus === "submitted" || kycStatus === "review"
      ? { key: "info", label: t("dashboardCabinet.overview.kycLevelReview", { defaultValue: "Verification: In review" }) }
      : { key: "warning", label: t("dashboardCabinet.overview.kycLevelBasic", { defaultValue: "Verification: Basic" }) };
  const miniNavItems = useMemo(
    () => [
      { key: "activity", label: t("dashboardCabinet.overview.miniNavActivity", { defaultValue: "Activity" }) },
      { key: "referral", label: t("dashboardCabinet.overview.miniNavReferral", { defaultValue: "Referral" }) },
      { key: "kyc", label: t("dashboardCabinet.overview.miniNavKyc", { defaultValue: "KYC" }) },
      { key: "security", label: t("dashboardCabinet.overview.miniNavSecurity", { defaultValue: "Security" }) },
    ],
    [t]
  );

  useEffect(() => {
    window.localStorage.setItem(kycWizardStorageKey, String(kycWizardStep));
  }, [kycWizardStorageKey, kycWizardStep]);

  return (
    <>
      {error ? <p className="dash-alert is-error">{error}</p> : null}
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading ? <p className="dash-muted">{t("dashboardCabinet.messages.loadingOverview")}</p> : null}
      <ActionPopupCard
        icon={FiTrendingUp}
        title={t("dashboardCabinet.buyPower.startEarningTitle", { defaultValue: "Start earning!" })}
        description={t("dashboardCabinet.buyPower.startEarningText", { defaultValue: "Open the tariff marketplace and buy mining power from your dashboard." })}
        ctaLabel={t("dashboardCabinet.buyPower.openMarket", { defaultValue: "Open buy screen" })}
        onClick={() => navigate("/dashboard/buy-power")}
      />
      <div className="overview-mini-nav" role="navigation" aria-label={t("dashboardCabinet.overview.miniNavAria", { defaultValue: "Overview section navigation" })}>
        {miniNavItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`overview-mini-nav-item ${overviewSection === item.key ? "is-active" : ""}`}
            onClick={() => {
              setOverviewSection(item.key);
              document.getElementById(`overview-${item.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="dash-help">{t("dashboardCabinet.overview.hourlyUpdateHint", { defaultValue: "Mining earnings are updated hourly and displayed with 4 decimal precision." })}</p>
      <div className="dashboard-workflow-banner" id="overview-activity">
        <strong>{t("dashboardCabinet.nextActionTitle", { defaultValue: "Next best action:" })}</strong>
        <p className="dash-help">{t("dashboardCabinet.overview.lastSync", { defaultValue: "Last sync" })}: {formatLastUpdatedLabel(overviewSyncAt, t)}</p>
        <div className="dashboard-workflow-steps">
          <span className={workflowStep >= 1 ? "is-active" : ""}><FiUserCheck />KYC</span>
          <span className={workflowStep >= 2 ? "is-active" : ""}><FiCreditCard />Funding</span>
          <span className={workflowStep >= 3 ? "is-active" : ""}><FiTrendingUp />Contract</span>
          <span className={workflowStep >= 4 ? "is-active" : ""}><FiDollarSign />Withdrawal</span>
        </div>
      </div>
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
          <p className="metric-label">{t("dashboardCabinet.metrics.balance")}</p>
          <h4 className="metric-value">{money(balance)}</h4>
        </article>
        <article className="dashboard-panel metric-card">
          <FiDollarSign className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.available")}</p>
          <h4 className="metric-value">{money(availableBalance)}</h4>
        </article>
        <article className="dashboard-panel metric-card">
          <FiLock className="metric-icon" />
          <p className="metric-label">{t("dashboardCabinet.metrics.held")}</p>
          <h4 className="metric-value">{money(heldBalance)}</h4>
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
            <p><strong>{t("dashboardCabinet.overview.link")}:</strong> {referral?.link || "-"}</p>
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
                  const ok = await copyTextWithFeedback(referral?.link || "", {
                    onSuccess: () => setStatus(t("dashboardCabinet.actions.copied", { defaultValue: "Copied" })),
                    onError: () => setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." })),
                  });
                  if (!ok) setError(t("dashboardCabinet.messages.copyFailed", { defaultValue: "Copy failed." }));
                }}
              >
                {t("dashboardCabinet.actions.copyLink", { defaultValue: "Copy link" })}
              </button>
            </div>
            <p>
              <strong>{t("dashboardCabinet.overview.invites")}:</strong> L1 {referral?.invitesByLevel?.["1"] || 0}, L2 {referral?.invitesByLevel?.["2"] || 0}, L3{" "}
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
        <div className="dashboard-panel is-accent" id="overview-kyc">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.overview.kycTitle")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.overview.kycHint", { defaultValue: "KYC status affects withdrawal limits and manual review requirements." })}</p>
            <p><strong>{t("dashboardCabinet.overview.status")}:</strong> {kycStepLabel} {kyc?.required ? `(${t("dashboardCabinet.overview.required")})` : `(${t("dashboardCabinet.overview.optional")})`}</p>
            <div className="dash-meta-row">
              <span className={`dash-meta-badge is-${kycVerificationBadge.key}`}>
                <FiShield />
                {kycVerificationBadge.label}
              </span>
              <span className="dash-meta-badge is-info">
                <FiClock />
                {t("dashboardCabinet.overview.lastSync", { defaultValue: "Last sync" })}: {formatLastUpdatedLabel(overviewSyncAt, t)}
              </span>
            </div>
            <p className="dash-help">
              {t("dashboardCabinet.overview.kycAutoRefresh", { defaultValue: "KYC status auto-refreshes every 15 seconds while under review." })}
            </p>
            {(kycTraces || []).slice(0, 4).map((trace) => (
              <p key={trace.id} className="dash-help">
                {new Date(trace.createdAt || Date.now()).toLocaleString()} | {trace.actorType}: {trace.event} {trace.details ? `- ${trace.details}` : ""}
              </p>
            ))}
            <div className="dash-kyc-timeline">
              <span className={kycStatus === "not_started" ? "is-active" : "is-done"}>1. {t("dashboardCabinet.overview.kycNotStarted", { defaultValue: "Not started" })}</span>
              <span className={kycStatus === "submitted" || kycStatus === "review" ? "is-active" : ["approved", "rejected"].includes(kycStatus) ? "is-done" : ""}>2. {t("dashboardCabinet.overview.kycReview", { defaultValue: "Under review" })}</span>
              <span className={["approved", "rejected"].includes(kycStatus) ? "is-active" : ""}>3. {["approved"].includes(kycStatus) ? <FiCheckCircle /> : null} {t("dashboardCabinet.overview.kycResult", { defaultValue: "Result" })}</span>
            </div>
            {kyc?.reviewNote ? <p className="dash-alert is-error">{kyc.reviewNote}</p> : null}
            <div className="dash-kyc-wizard">
              <div className="dash-kyc-wizard-head">
                <strong>{t("dashboardCabinet.overview.kycWizardTitle", { defaultValue: "KYC Wizard" })}</strong>
                <span>{kycWizardCompletion}%</span>
              </div>
              <div className="dash-kyc-progress-track">
                <div className="dash-kyc-progress-fill" style={{ width: `${kycWizardCompletion}%` }} />
              </div>
              <div className="dash-kyc-steps">
                <button
                  type="button"
                  className={`dash-kyc-step-btn ${kycWizardStep >= 1 ? "is-active" : ""}`}
                  onClick={() => setKycWizardStep(1)}
                >
                  1. {t("dashboardCabinet.overview.country", { defaultValue: "Country" })}
                </button>
                <button
                  type="button"
                  className={`dash-kyc-step-btn ${kycWizardStep >= 2 ? "is-active" : ""}`}
                  onClick={() => setKycWizardStep(2)}
                  disabled={kycMaxUnlockedStep < 2}
                >
                  2. {t("dashboardCabinet.overview.docType", { defaultValue: "Document type" })}
                </button>
                <button
                  type="button"
                  className={`dash-kyc-step-btn ${kycWizardStep >= 3 ? "is-active" : ""}`}
                  onClick={() => setKycWizardStep(3)}
                  disabled={kycMaxUnlockedStep < 3}
                >
                  3. {t("dashboardCabinet.overview.document", { defaultValue: "Document" })}
                </button>
                <button
                  type="button"
                  className={`dash-kyc-step-btn ${kycWizardStep >= 4 ? "is-active" : ""}`}
                  onClick={() => setKycWizardStep(4)}
                  disabled={kycMaxUnlockedStep < 4}
                >
                  4. {t("dashboardCabinet.overview.reviewTitle", { defaultValue: "Review" })}
                </button>
              </div>
            </div>
            <form className="dash-form" onSubmit={submitKyc}>
              {kycWizardStep === 1 ? (
                <>
                  <label>{t("dashboardCabinet.overview.country")}</label>
                  <input id="kyc-country" className="dash-input" value={kycCountry} onChange={(e) => setKycCountry(e.target.value)} required />
                </>
              ) : null}
              {kycWizardStep === 2 ? (
                <>
                  <label htmlFor="kyc-doc-type">{t("dashboardCabinet.overview.docType", { defaultValue: "Document type" })}</label>
                  <select
                    id="kyc-doc-type"
                    className="dash-input"
                    value={kycDocType}
                    onChange={(e) => setKycDocType(e.target.value)}
                  >
                    <option value="id_card">{t("dashboardCabinet.overview.docTypeIdCard", { defaultValue: "ID card" })}</option>
                    <option value="passport">{t("dashboardCabinet.overview.docTypePassport", { defaultValue: "Passport" })}</option>
                    <option value="driver_license">{t("dashboardCabinet.overview.docTypeDriver", { defaultValue: "Driver license" })}</option>
                  </select>
                </>
              ) : null}
              {kycWizardStep === 3 ? (
                <>
                  <label htmlFor="kyc-document">{t("dashboardCabinet.overview.document")}</label>
                  <div
                    className={`dash-file-dropzone ${kycDragActive ? "is-active" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setKycDragActive(true);
                    }}
                    onDragLeave={() => setKycDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setKycDragActive(false);
                      const file = event.dataTransfer?.files?.[0] || null;
                      setKycFile(file);
                    }}
                  >
                    <input id="kyc-document" className="dash-input" type="file" onChange={(e) => setKycFile(e.target.files?.[0] || null)} />
                    <p className="dash-help">
                      {t("dashboardCabinet.overview.kycDropHint", { defaultValue: "Drag and drop file here or use file picker (JPG/PNG/PDF, max 8MB)." })}
                    </p>
                    {kycFile ? (
                      <p className="dash-help">
                        {t("dashboardCabinet.overview.selectedFile", { defaultValue: "Selected file" })}: {kycFile.name} ({(Number(kycFile.size || 0) / 1024 / 1024).toFixed(2)} MB)
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
              {kycWizardStep === 4 ? (
                <div className="dash-state-card">
                  <p className="dash-state-title">{t("dashboardCabinet.overview.reviewTitle", { defaultValue: "Review details before submit" })}</p>
                  <p className="dash-state-description">{t("dashboardCabinet.overview.country", { defaultValue: "Country" })}: {kycCountry || "-"}</p>
                  <p className="dash-state-description">{t("dashboardCabinet.overview.docType", { defaultValue: "Document type" })}: {kycDocType || "-"}</p>
                  <p className="dash-state-description">{t("dashboardCabinet.overview.selectedFile", { defaultValue: "Selected file" })}: {kycFile?.name || "-"}</p>
                </div>
              ) : null}
              <div className="dash-actions-cell">
                {kycWizardStep > 1 ? (
                  <button className="dash-btn is-secondary is-sm" type="button" onClick={() => setKycWizardStep((prev) => Math.max(1, prev - 1))}>
                    {t("dashboardCabinet.actions.back", { defaultValue: "Back" })}
                  </button>
                ) : null}
                <button className="dash-btn is-primary" type="submit">
                  {kycWizardStep < 4
                    ? t("dashboardCabinet.actions.continue", { defaultValue: "Continue" })
                    : t("dashboardCabinet.overview.submitKyc", { defaultValue: "Submit KYC" })}
                </button>
              </div>
            </form>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>{t("dashboardCabinet.overview.document", { defaultValue: "Document" })}</th><th>{t("dashboardCabinet.table.type", { defaultValue: "Type" })}</th><th>{t("dashboardCabinet.table.date", { defaultValue: "Date" })}</th><th>{t("dashboardCabinet.table.action", { defaultValue: "Action" })}</th></tr></thead>
                <tbody>
                  {(kyc?.documents || []).length === 0 ? (
                    <tr><td colSpan={4}>{t("dashboardCabinet.empty.noKycDocs", { defaultValue: "No KYC documents submitted yet." })}</td></tr>
                  ) : (kyc.documents || []).map((doc) => (
                    <tr key={doc.id}>
                      <td data-label={t("dashboardCabinet.overview.document", { defaultValue: "Document" })}>{doc.docType}</td>
                      <td data-label={t("dashboardCabinet.table.type", { defaultValue: "Type" })}>{doc.mimeType || "-"}</td>
                      <td data-label={t("dashboardCabinet.table.date", { defaultValue: "Date" })}>{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "-"}</td>
                      <td data-label={t("dashboardCabinet.table.action", { defaultValue: "Action" })}>
                        <a className="dash-btn is-secondary is-sm" href={`/api/user/kyc/document/${doc.id}`} target="_blank" rel="noreferrer">
                          {t("dashboardCabinet.actions.download", { defaultValue: "Download" })}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid dashboard-grid-2" id="overview-security">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.overview.changePassword")}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.overview.passwordHint", { defaultValue: "Update password immediately if you suspect unauthorized access." })}</p>
            <form className="dash-form" onSubmit={submitPassword}>
              <label htmlFor="current-password">{t("dashboardCabinet.overview.currentPassword")}</label>
              <input id="current-password" className="dash-input" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required />
              <label htmlFor="new-password">{t("dashboardCabinet.overview.newPassword")}</label>
              <input id="new-password" className="dash-input" type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              <div className="password-strength mb-2">
                <div className="password-strength-track">
                  <div className={`password-strength-fill is-${newPasswordStrength.tone}`} style={{ width: `${newPasswordStrength.percent}%` }} />
                </div>
                <small>{t("auth.passwordStrength", { defaultValue: "Password strength" })}: {newPasswordStrength.percent}%</small>
              </div>
              <p className="dash-help">{t("dashboardCabinet.overview.passwordSecurityHint", { defaultValue: "Use at least 8 characters with mixed symbols and numbers." })}</p>
              <button className="dash-btn is-primary" type="submit">{t("dashboardCabinet.overview.updatePassword")}</button>
            </form>
          </div>
        </div>
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.overview.securityTitle", { defaultValue: "Security controls" })}</h5></div>
          <div className="dashboard-panel-body">
            <p className="dash-help">{t("dashboardCabinet.overview.securityPanelHint", { defaultValue: "Security toggles apply locally first and require server-side policy confirmation." })}</p>
            <label className="dash-checkbox">
              <input
                type="checkbox"
                checked={security2fa}
                onChange={async (e) => {
                  setSecurity2fa(e.target.checked);
                  if (e.target.checked) {
                    const enrolled = await apiPost("/api/user/security/2fa/enroll", {});
                    setTwoFactorSecret(enrolled.secret || "");
                    setStatus(t("dashboardCabinet.overview.twoFactorEnrollStarted", { defaultValue: "2FA enrollment started. Enter verification code." }));
                  } else {
                    setTwoFactorSecret("");
                  }
                }}
              />
              <span>{t("dashboardCabinet.overview.enable2fa", { defaultValue: "Enable 2FA for login sessions" })}</span>
            </label>
            {twoFactorSecret ? (
              <div className="dash-inline-confirm">
                <p className="dash-help">{t("dashboardCabinet.overview.twoFactorSecret", { defaultValue: "2FA secret" })}: <code>{twoFactorSecret}</code></p>
                <input className="dash-input" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} placeholder="123456" />
                <button className="dash-btn is-secondary is-sm" type="button" onClick={async () => {
                  await apiPost("/api/user/security/2fa/verify", { code: twoFactorCode });
                  setTwoFactorSecret("");
                  setTwoFactorCode("");
                  await load();
                  setStatus(t("dashboardCabinet.messages.saved", { defaultValue: "Changes saved." }));
                }}>
                  {t("dashboardCabinet.actions.confirm", { defaultValue: "Confirm" })}
                </button>
              </div>
            ) : null}
            <label className="dash-checkbox">
              <input
                type="checkbox"
                checked={stepUp}
                onChange={(e) => {
                  setStepUp(e.target.checked);
                  window.localStorage.setItem("cm_security_stepup", e.target.checked ? "enabled" : "disabled");
                  setStatus(
                    t("dashboardCabinet.overview.securityLocalOnly", {
                      defaultValue: "Security preference updated locally. Server confirmation pending.",
                    })
                  );
                }}
              />
              <span>{t("dashboardCabinet.overview.enableStepUp", { defaultValue: "Require security code for withdrawals and password changes" })}</span>
            </label>
            <p className="dash-help">
              {t("dashboardCabinet.overview.serverSecurityStatus", {
                defaultValue: "Server-enforced policy status: pending confirmation",
              })}
            </p>
            <p className="dash-help">{t("dashboardCabinet.overview.securityHint", { defaultValue: "These controls are enforced in UI and can be bound to backend policies." })}</p>
            <div className="dash-actions-cell">
              <button className="dash-btn is-secondary is-sm" type="button" onClick={async () => {
                await apiPost("/api/user/security/trusted-devices", { label: "Current browser" });
                await load();
              }}>
                {t("dashboardCabinet.overview.trustCurrentDevice", { defaultValue: "Trust current device" })}
              </button>
              <button className="dash-btn is-danger-ghost is-sm" type="button" onClick={async () => {
                await apiPost("/api/user/security/sessions/revoke", { revokeAll: true });
                setStatus(t("dashboardCabinet.overview.sessionsRevoked", { defaultValue: "All sessions revoked." }));
                await load();
              }}>
                {t("dashboardCabinet.overview.revokeAllSessions", { defaultValue: "Revoke all sessions" })}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="dashboard-panel-header"><h5>{t("dashboardCabinet.overview.trustPanel", { defaultValue: "Trust and security panel" })}</h5></div>
          <div className="dashboard-panel-body">
            <div className="dashboard-grid dashboard-grid-5">
              <article className="dashboard-panel metric-card">
                <p className="metric-label">{t("dashboardCabinet.overview.lastLogin", { defaultValue: "Last login" })}</p>
                <h4 className="metric-value">{new Date(lastLoginAt).toLocaleString()}</h4>
              </article>
              <article className="dashboard-panel metric-card">
                <p className="metric-label">{t("dashboardCabinet.overview.activeSessions", { defaultValue: "Active sessions" })}</p>
                <h4 className="metric-value">{Number(securitySettings?.activeSessions || activeSessions)}</h4>
              </article>
              <article className="dashboard-panel metric-card">
                <p className="metric-label">{t("dashboardCabinet.overview.security2fa", { defaultValue: "2FA status" })}</p>
                <h4 className="metric-value">
                  {security2fa
                    ? t("dashboardCabinet.status.enabled", { defaultValue: "Enabled" })
                    : t("dashboardCabinet.status.disabled", { defaultValue: "Disabled" })}
                </h4>
              </article>
              <article className="dashboard-panel metric-card">
                <p className="metric-label">{t("dashboardCabinet.overview.stepUpStatus", { defaultValue: "Step-up status" })}</p>
                <h4 className="metric-value">
                  {stepUp
                    ? t("dashboardCabinet.status.enabled", { defaultValue: "Enabled" })
                    : t("dashboardCabinet.status.disabled", { defaultValue: "Disabled" })}
                </h4>
              </article>
            </div>
            <div className="table-shell">
              <table className="dash-table">
                <thead><tr><th>{t("dashboardCabinet.table.date")}</th><th>{t("dashboardCabinet.table.note")}</th></tr></thead>
                <tbody>
                  {securityEvents.map((event) => (
                    <tr key={event.id}>
                      <td data-label={t("dashboardCabinet.table.date")}>{new Date(event.createdAt).toLocaleString()}</td>
                      <td data-label={t("dashboardCabinet.table.note")}>{event.label}</td>
                    </tr>
                  ))}
                  {sessions.map((item) => (
                    <tr key={`session-${item.id}`}>
                      <td data-label={t("dashboardCabinet.table.date")}>{new Date(item.createdAt || Date.now()).toLocaleString()}</td>
                      <td data-label={t("dashboardCabinet.table.note")}>{item.isRevoked ? "revoked" : "active"} | {item.ipAddress || "-"} | {(item.userAgent || "").slice(0, 50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
