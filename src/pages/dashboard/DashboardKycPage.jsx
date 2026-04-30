import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPostForm } from "../../api/client";
import { formatLastUpdatedLabel, getSafeErrorMessage } from "./utils";
import { FiCheckCircle, FiClock, FiShield } from "react-icons/fi";
import ReactFlagsSelect from "react-flags-select";
import { detectDefaultCountryCode, getCountryDisplayLabels } from "../../utils/countryCatalog";

export function DashboardKycPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [kyc, setKyc] = useState(null);
  const [overviewSyncAt, setOverviewSyncAt] = useState("");
  const [kycCountry, setKycCountry] = useState("");
  const [kycDocType, setKycDocType] = useState("id_card");
  const [kycFile, setKycFile] = useState(null);
  const [kycDragActive, setKycDragActive] = useState(false);
  const [kycWizardStep, setKycWizardStep] = useState(1);
  const [kycTraces, setKycTraces] = useState([]);
  const [countrySelectorKey, setCountrySelectorKey] = useState(0);
  const countryLabels = useMemo(() => getCountryDisplayLabels(), []);
  const countryCodes = useMemo(() => Object.keys(countryLabels), [countryLabels]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [kycData, kycTraceData] = await Promise.all([
        apiGet("/api/user/kyc"),
        apiGet("/api/user/dashboard/audit-traces?scope=kyc"),
      ]);
      setKyc(kycData || null);
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
    if (kycCountry) return;
    const detected = detectDefaultCountryCode();
    if (detected) setKycCountry(detected);
  }, [kycCountry]);

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

  return (
    <>
      {error ? <p className="dash-alert is-error">{error}</p> : null}
      {status ? <p className="dash-alert is-success">{status}</p> : null}
      {loading ? <p className="dash-muted">{t("dashboardCabinet.messages.loadingOverview")}</p> : null}
      <div className="dashboard-panel is-accent">
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
              <button type="button" className={`dash-kyc-step-btn ${kycWizardStep >= 1 ? "is-active" : ""}`} onClick={() => setKycWizardStep(1)}>
                1. {t("dashboardCabinet.overview.country", { defaultValue: "Country" })}
              </button>
              <button type="button" className={`dash-kyc-step-btn ${kycWizardStep >= 2 ? "is-active" : ""}`} onClick={() => setKycWizardStep(2)} disabled={kycMaxUnlockedStep < 2}>
                2. {t("dashboardCabinet.overview.docType", { defaultValue: "Document type" })}
              </button>
              <button type="button" className={`dash-kyc-step-btn ${kycWizardStep >= 3 ? "is-active" : ""}`} onClick={() => setKycWizardStep(3)} disabled={kycMaxUnlockedStep < 3}>
                3. {t("dashboardCabinet.overview.document", { defaultValue: "Document" })}
              </button>
              <button type="button" className={`dash-kyc-step-btn ${kycWizardStep >= 4 ? "is-active" : ""}`} onClick={() => setKycWizardStep(4)} disabled={kycMaxUnlockedStep < 4}>
                4. {t("dashboardCabinet.overview.reviewTitle", { defaultValue: "Review" })}
              </button>
            </div>
          </div>
          <form className="dash-form" onSubmit={submitKyc}>
            {kycWizardStep === 1 ? (
              <>
                <label>{t("dashboardCabinet.overview.country")}</label>
                <div className="country-select-shell">
                  <ReactFlagsSelect
                    key={`kyc-country-${countrySelectorKey}`}
                    selected={kycCountry}
                    onSelect={(code) => {
                      setKycCountry(code);
                      setCountrySelectorKey((prev) => prev + 1);
                    }}
                    searchable
                    countries={countryCodes}
                    customLabels={Object.fromEntries(
                      countryCodes.map((code) => [code, `${countryLabels[code]?.en || code} / ${countryLabels[code]?.ru || code}`])
                    )}
                    placeholder={t("auth.selectCountry")}
                  />
                </div>
              </>
            ) : null}
            {kycWizardStep === 2 ? (
              <>
                <label htmlFor="kyc-doc-type">{t("dashboardCabinet.overview.docType", { defaultValue: "Document type" })}</label>
                <select id="kyc-doc-type" className="dash-input" value={kycDocType} onChange={(e) => setKycDocType(e.target.value)}>
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
    </>
  );
}
