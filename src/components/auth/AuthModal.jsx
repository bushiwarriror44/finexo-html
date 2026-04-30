import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import ReactFlagsSelect from "react-flags-select";
import { detectDefaultCountryCode, getCountryDisplayLabels } from "../../utils/countryCatalog";
import { getAuthErrorMessage, getAuthFieldErrors } from "../../utils/authErrorI18n";
import { getPasswordStrength } from "../../utils/passwordStrength";
import { AuthCaptcha } from "./AuthCaptcha";

const MODES = new Set(["login", "register", "forgot", "reset"]);

export function AuthModal() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [countrySelectorKey, setCountrySelectorKey] = useState(0);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultType, setResultType] = useState("success");
  const [resultMessage, setResultMessage] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const modalRef = useRef(null);
  const lastFocusedRef = useRef(null);
  const autoSelectedCountryRef = useRef(false);

  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const mode = search.get("auth");
  const isOpen = MODES.has(mode || "");
  const token = search.get("token") || "";
  const referralCode = search.get("ref") || "";
  const countryLabels = useMemo(() => getCountryDisplayLabels(), []);
  const countryCodes = useMemo(() => Object.keys(countryLabels), [countryLabels]);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const handleCaptchaMetaChange = useCallback(({ captchaId: nextId }) => {
    setCaptchaId(nextId);
  }, []);

  const updateMode = (nextMode, extras = {}) => {
    const params = new URLSearchParams(location.search);
    if (nextMode) {
      params.set("auth", nextMode);
    } else {
      params.delete("auth");
    }
    Object.entries(extras).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
    setError("");
    setFieldErrors({});
    setStatus("");
    setPassword("");
    setRememberMe(true);
    setFirstName("");
    setLastName("");
    setCountryCode("");
    setCaptchaId("");
    setCaptchaAnswer("");
    setCountrySelectorKey((prev) => prev + 1);
    autoSelectedCountryRef.current = false;
  };

  const close = () => {
    const params = new URLSearchParams(location.search);
    params.delete("auth");
    params.delete("token");
    params.delete("next");
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
    setError("");
    setFieldErrors({});
    setStatus("");
    setPassword("");
    setRememberMe(true);
    setFirstName("");
    setLastName("");
    setCountryCode("");
    setCaptchaId("");
    setCaptchaAnswer("");
    setCountrySelectorKey((prev) => prev + 1);
    autoSelectedCountryRef.current = false;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setStatus("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password, rememberMe, captchaId, captchaAnswer);
        setResultType("success");
        setResultMessage(t("auth.result.loginSuccess"));
        setPendingAction("goDashboard");
        setResultOpen(true);
        return;
      }
      if (mode === "register") {
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
        setPendingAction("toLoginMode");
        setResultOpen(true);
        return;
      }
      if (mode === "forgot") {
        await apiPost("/api/auth/forgot-password", {
          email,
          frontendUrl: `${window.location.origin}/reset-password`,
        });
        setStatus(t("auth.resetSent"));
        return;
      }
      if (mode === "reset") {
        await apiPost("/api/auth/reset-password", { token, password });
        setStatus(t("auth.passwordResetDone"));
        updateMode("login", { token: "" });
      }
    } catch (err) {
      setFieldErrors(getAuthFieldErrors(err, t));
      const message = getAuthErrorMessage(err, t);
      setError(message);
      if (mode === "login" || mode === "register") {
        setResultType("error");
        setResultMessage(message);
        setPendingAction("");
        setResultOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const closeResult = () => {
    const action = pendingAction;
    setResultOpen(false);
    setPendingAction("");
    if (action === "goDashboard") {
      close();
      navigate("/dashboard");
      return;
    }
    if (action === "toLoginMode") {
      updateMode("login", { ref: "" });
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    lastFocusedRef.current = document.activeElement;
    const node = modalRef.current;
    const focusables = node?.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    const first = focusables?.[0];
    first?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || !focusables?.length) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (lastFocusedRef.current && typeof lastFocusedRef.current.focus === "function") {
        lastFocusedRef.current.focus();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || mode !== "register" || countryCode || autoSelectedCountryRef.current) return;
    const detected = detectDefaultCountryCode();
    if (detected) {
      setTimeout(() => setCountryCode(detected), 0);
      autoSelectedCountryRef.current = true;
    }
  }, [countryCode, isOpen, mode]);

  if (!isOpen) return null;

  return (
    <div className="auth-modal-backdrop" onClick={close}>
      <div ref={modalRef} className="auth-modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" type="button" onClick={close} aria-label="Close">
          ×
        </button>
        <h3 id="auth-modal-title" className="auth-modal-title">
          {mode === "login" && t("auth.signIn")}
          {mode === "register" && t("auth.createAccount")}
          {mode === "forgot" && t("auth.passwordRecovery")}
          {mode === "reset" && t("auth.setNewPassword")}
        </h3>
        <form onSubmit={submit} className="auth-modal-form">
          {(mode === "login" || mode === "register" || mode === "forgot") && (
            <input
              className={`form-control ${fieldErrors.email ? "is-invalid" : ""}`}
              type="email"
              placeholder={t("auth.email")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((prev) => ({ ...prev, email: "" }));
              }}
              required
            />
          )}
          {fieldErrors.email ? <div className="invalid-feedback d-block">{fieldErrors.email}</div> : null}
          {(mode === "login" || mode === "register" || mode === "reset") && (
            <input
              className={`form-control ${fieldErrors.password ? "is-invalid" : ""}`}
              type="password"
              placeholder={mode === "reset" ? t("auth.newPassword") : t("auth.password")}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((prev) => ({ ...prev, password: "" }));
              }}
              required
            />
          )}
          {fieldErrors.password ? <div className="invalid-feedback d-block">{fieldErrors.password}</div> : null}
          {(mode === "register" || mode === "reset") ? (
            <div className="password-strength mb-2">
              <div className="password-strength-track">
                <div className={`password-strength-fill is-${passwordStrength.tone}`} style={{ width: `${passwordStrength.percent}%` }} />
              </div>
              <small>{t("auth.passwordStrength", { defaultValue: "Password strength" })}: {passwordStrength.percent}%</small>
            </div>
          ) : null}
          {mode === "login" ? (
            <label className="dash-checkbox">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <span>{t("auth.rememberMe")}</span>
            </label>
          ) : null}
          {(mode === "login" || mode === "register") ? (
            <AuthCaptcha
              t={t}
              value={captchaAnswer}
              onChange={setCaptchaAnswer}
              onMetaChange={handleCaptchaMetaChange}
              className="mb-2"
            />
          ) : null}
          {mode === "register" ? (
            <>
              <input
                className={`form-control ${fieldErrors.firstName ? "is-invalid" : ""}`}
                type="text"
                placeholder={t("auth.firstName")}
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, firstName: "" }));
                }}
                required
              />
              {fieldErrors.firstName ? <div className="invalid-feedback d-block">{fieldErrors.firstName}</div> : null}
              <input
                className={`form-control ${fieldErrors.lastName ? "is-invalid" : ""}`}
                type="text"
                placeholder={t("auth.lastName")}
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, lastName: "" }));
                }}
                required
              />
              {fieldErrors.lastName ? <div className="invalid-feedback d-block">{fieldErrors.lastName}</div> : null}
              <div className="country-select-shell">
                <ReactFlagsSelect
                  key={`modal-country-${countrySelectorKey}`}
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
                {fieldErrors.countryCode ? <div className="invalid-feedback d-block">{fieldErrors.countryCode}</div> : null}
              </div>
            </>
          ) : null}
          {error ? <p className="text-warning mb-0">{error}</p> : null}
          {status ? <p className="text-info mb-0">{status}</p> : null}
          <button className="btn btn-info text-white w-100" type="submit" disabled={busy || (mode === "reset" && !token)}>
            {mode === "login" && t("auth.signIn")}
            {mode === "register" && t("auth.createAccount")}
            {mode === "forgot" && t("auth.sendResetLink")}
            {mode === "reset" && t("auth.resetPassword")}
          </button>
        </form>
        <div className="auth-modal-links">
          {mode !== "login" ? (
            <button type="button" onClick={() => updateMode("login")}>{t("auth.backToLogin")}</button>
          ) : null}
          {mode === "login" ? (
            <>
              <button type="button" onClick={() => updateMode("register", { ref: referralCode || undefined })}>{t("auth.register")}</button>
              <button type="button" onClick={() => updateMode("forgot")}>{t("auth.forgotPassword")}</button>
            </>
          ) : null}
        </div>
      </div>
      {resultOpen ? (
        <div className="auth-result-backdrop" onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}
