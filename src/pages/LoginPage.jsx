import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { getAuthErrorMessage, getAuthFieldErrors } from "../utils/authErrorI18n";
import { AuthCaptcha } from "../components/auth/AuthCaptcha";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [resultOpen, setResultOpen] = useState(false);
  const [resultType, setResultType] = useState("success");
  const [resultMessage, setResultMessage] = useState("");
  const [pendingRedirect, setPendingRedirect] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    try {
      await login(email, password, rememberMe, captchaId, captchaAnswer);
      setResultType("success");
      setResultMessage(t("auth.result.loginSuccess"));
      setPendingRedirect("/dashboard");
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

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center"><h2>{t("auth.signIn")}</h2></div>
        <form onSubmit={onSubmit} className="mx-auto" style={{ maxWidth: 420 }}>
          {error ? <p className="text-warning">{error}</p> : null}
          <input
            className={`form-control mb-1 ${fieldErrors.email ? "is-invalid" : ""}`}
            type="email"
            placeholder={t("auth.email")}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((prev) => ({ ...prev, email: "" }));
            }}
            required
          />
          {fieldErrors.email ? <div className="invalid-feedback d-block mb-2">{fieldErrors.email}</div> : <div className="mb-3" />}
          <input
            className={`form-control mb-1 ${fieldErrors.password ? "is-invalid" : ""}`}
            type="password"
            placeholder={t("auth.password")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: "" }));
            }}
            required
          />
          {fieldErrors.password ? <div className="invalid-feedback d-block mb-2">{fieldErrors.password}</div> : <div className="mb-3" />}
          <label className="dash-checkbox mb-3">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            <span>{t("auth.rememberMe")}</span>
          </label>
          <AuthCaptcha
            t={t}
            value={captchaAnswer}
            onChange={setCaptchaAnswer}
            onMetaChange={({ captchaId: nextId }) => setCaptchaId(nextId)}
          />
          <button className="btn btn-info text-white w-100" type="submit">{t("auth.signIn")}</button>
          <div className="mt-3 d-flex justify-content-between">
            <Link to="/register">{t("auth.register")}</Link>
            <Link to="/forgot-password">{t("auth.forgotPassword")}</Link>
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
