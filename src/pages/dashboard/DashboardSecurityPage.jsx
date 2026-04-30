import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../api/client";
import { formatDateTimeRu, getSafeErrorMessage } from "./utils";
import { getPasswordStrength } from "../../utils/passwordStrength";

export function DashboardSecurityPage() {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [security2fa, setSecurity2fa] = useState(window.localStorage.getItem("cm_security_2fa") === "enabled");
  const [stepUp, setStepUp] = useState(window.localStorage.getItem("cm_security_stepup") === "enabled");
  const [lastLoginAt] = useState(window.localStorage.getItem("cm_security_last_login") || new Date().toISOString());
  const [activeSessions] = useState(Number(window.localStorage.getItem("cm_security_active_sessions") || "1"));
  const [securitySettings, setSecuritySettings] = useState(null);
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [sessions, setSessions] = useState([]);
  const [securityEvents] = useState(() => [
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
  ]);
  const newPasswordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  const load = useCallback(async () => {
    try {
      const [secData, sessionData] = await Promise.all([
        apiGet("/api/user/security/settings"),
        apiGet("/api/user/security/sessions"),
      ]);
      setSecuritySettings(secData || null);
      setSecurity2fa(Boolean(secData?.twoFactorEnabled));
      setStepUp(Boolean(secData?.stepUpRequired));
      setSessions(Array.isArray(sessionData) ? sessionData : []);
    } catch (err) {
      setError(getSafeErrorMessage(err, t("dashboardCabinet.messages.failedLoadOverview")));
    }
  }, [t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

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

  return (
    <>
      {error ? <p className="dash-alert is-error">{error}</p> : null}
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      <div className="dashboard-grid dashboard-grid-2">
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
                <h4 className="metric-value">{formatDateTimeRu(lastLoginAt)}</h4>
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
                      <td data-label={t("dashboardCabinet.table.date")}>{formatDateTimeRu(event.createdAt)}</td>
                      <td data-label={t("dashboardCabinet.table.note")}>{event.label}</td>
                    </tr>
                  ))}
                  {sessions.map((item) => (
                    <tr key={`session-${item.id}`}>
                      <td data-label={t("dashboardCabinet.table.date")}>{item.createdAt ? formatDateTimeRu(item.createdAt) : "-"}</td>
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
