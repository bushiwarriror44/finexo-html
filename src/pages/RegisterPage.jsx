import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import ReactFlagsSelect from "react-flags-select";
import { detectDefaultCountryCode, getCountryDisplayLabels } from "../utils/countryCatalog";
import { getAuthErrorMessage, getAuthFieldErrors } from "../utils/authErrorI18n";
import { getPasswordStrength } from "../utils/passwordStrength";
import { AuthCaptcha } from "../components/auth/AuthCaptcha";

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [countrySelectorKey, setCountrySelectorKey] = useState(0);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [resultOpen, setResultOpen] = useState(false);
  const [resultType, setResultType] = useState("success");
  const [resultMessage, setResultMessage] = useState("");
  const [pendingRedirect, setPendingRedirect] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const autoSelectedCountryRef = useRef(false);
  const countryLabels = useMemo(() => getCountryDisplayLabels(), []);
  const countryCodes = useMemo(() => Object.keys(countryLabels), [countryLabels]);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const handleCaptchaMetaChange = useCallback(({ captchaId: nextId }) => {
    setCaptchaId(nextId);
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    try {
      const referralCode = searchParams.get("ref") || "";
      await register({
        email,
        password,
        referralCode,
        firstName,
        lastName,
        countryCode,
        captchaId,
        captchaAnswer,
      });
      setResultType("success");
      setResultMessage(t("auth.result.registerSuccess"));
      setPendingRedirect("/login");
      setResultOpen(true);
    } catch (err) {
      setFieldErrors(getAuthFieldErrors(err, t));
      const message = getAuthErrorMessage(err, t);
      setError(message);
      setResultType("error");
      setResultMessage(message);
      setPendingRedirect("");
      setResultOpen(true);
    }
  };

  const closeResult = () => {
    setResultOpen(false);
    if (pendingRedirect) {
      navigate(pendingRedirect);
      setPendingRedirect("");
    }
  };

  useEffect(() => {
    if (countryCode || autoSelectedCountryRef.current) return;
    const detected = detectDefaultCountryCode();
    if (detected) {
      setTimeout(() => setCountryCode(detected), 0);
      autoSelectedCountryRef.current = true;
    }
  }, [countryCode]);

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center"><h2>{t("auth.createAccount")}</h2></div>
        <form onSubmit={onSubmit} className="mx-auto" style={{ maxWidth: 420 }}>
          {error ? <p className="text-warning">{error}</p> : null}
          <input className={`form-control mb-1 ${fieldErrors.firstName ? "is-invalid" : ""}`} type="text" placeholder={t("auth.firstName")} value={firstName} onChange={(e) => {
            setFirstName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, firstName: "" }));
          }} required />
          {fieldErrors.firstName ? <div className="invalid-feedback d-block mb-2">{fieldErrors.firstName}</div> : <div className="mb-3" />}
          <input className={`form-control mb-1 ${fieldErrors.lastName ? "is-invalid" : ""}`} type="text" placeholder={t("auth.lastName")} value={lastName} onChange={(e) => {
            setLastName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, lastName: "" }));
          }} required />
          {fieldErrors.lastName ? <div className="invalid-feedback d-block mb-2">{fieldErrors.lastName}</div> : <div className="mb-3" />}
          <input className={`form-control mb-1 ${fieldErrors.email ? "is-invalid" : ""}`} type="email" placeholder={t("auth.email")} value={email} onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((prev) => ({ ...prev, email: "" }));
          }} required />
          {fieldErrors.email ? <div className="invalid-feedback d-block mb-2">{fieldErrors.email}</div> : <div className="mb-3" />}
          <input className={`form-control mb-1 ${fieldErrors.password ? "is-invalid" : ""}`} type="password" placeholder={`${t("auth.password")} (min 8)`} value={password} onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors((prev) => ({ ...prev, password: "" }));
          }} required />
          <div className="password-strength mb-2">
            <div className="password-strength-track">
              <div className={`password-strength-fill is-${passwordStrength.tone}`} style={{ width: `${passwordStrength.percent}%` }} />
            </div>
            <small>{t("auth.passwordStrength", { defaultValue: "Password strength" })}: {passwordStrength.percent}%</small>
          </div>
          {fieldErrors.password ? <div className="invalid-feedback d-block mb-2">{fieldErrors.password}</div> : <div className="mb-3" />}
          <div className="mb-3 country-select-shell">
            <ReactFlagsSelect
              key={`register-country-${countrySelectorKey}`}
              selected={countryCode}
              onSelect={(code) => {
                setCountryCode(code);
                setFieldErrors((prev) => ({ ...prev, countryCode: "" }));
                setCountrySelectorKey((prev) => prev + 1);
              }}
              searchable
              countries={countryCodes}
              customLabels={Object.fromEntries(
                countryCodes.map((code) => [code, `${countryLabels[code]?.en || code} / ${countryLabels[code]?.ru || code}`])
              )}
              placeholder={t("auth.selectCountry")}
            />
            {fieldErrors.countryCode ? <div className="invalid-feedback d-block mt-2">{fieldErrors.countryCode}</div> : null}
          </div>
          <AuthCaptcha
            t={t}
            value={captchaAnswer}
            onChange={setCaptchaAnswer}
            onMetaChange={handleCaptchaMetaChange}
          />
          <button className="btn btn-info text-white w-100" type="submit">{t("auth.createAccount")}</button>
          <div className="mt-3">
            <Link to="/login">{t("auth.backToLogin")}</Link>
          </div>
        </form>
      </div>
      {resultOpen ? (
        <div className="auth-result-backdrop">
          <div className="auth-result-card" role="alertdialog" aria-modal="true">
            <div className={`auth-result-icon ${resultType === "success" ? "is-success" : "is-error"}`} aria-hidden="true">
              {resultType === "success" ? "✓" : "!"}
            </div>
            <h4>{resultType === "success" ? t("auth.result.successTitle") : t("auth.result.errorTitle")}</h4>
            <p>{resultMessage}</p>
            <button type="button" className="btn btn-info text-white" onClick={closeResult}>
              {t("auth.result.ok")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
