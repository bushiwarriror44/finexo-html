import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiPost } from "../api/client";
import { useTranslation } from "react-i18next";
import { getAuthErrorMessage, getAuthFieldErrors } from "../utils/authErrorI18n";
import { getPasswordStrength } from "../utils/passwordStrength";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const strength = getPasswordStrength(password);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setStatus("");
    try {
      await apiPost("/api/auth/reset-password", { token, password });
      setStatus(t("auth.passwordResetDone"));
    } catch (err) {
      setFieldErrors(getAuthFieldErrors(err, t));
      setError(getAuthErrorMessage(err, t));
    }
  };

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center"><h2>{t("auth.setNewPassword")}</h2></div>
        <form onSubmit={onSubmit} className="mx-auto" style={{ maxWidth: 420 }}>
          {error ? <p className="text-warning">{error}</p> : null}
          {status ? <p className="text-info">{status}</p> : null}
          <input
            className={`form-control mb-1 ${fieldErrors.password ? "is-invalid" : ""}`}
            type="password"
            placeholder={t("auth.newPassword")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: "" }));
            }}
            required
          />
          <div className="password-strength mb-2">
            <div className="password-strength-track">
              <div className={`password-strength-fill is-${strength.tone}`} style={{ width: `${strength.percent}%` }} />
            </div>
            <small>{t("auth.passwordStrength", { defaultValue: "Password strength" })}: {strength.percent}%</small>
          </div>
          {fieldErrors.password ? <div className="invalid-feedback d-block mb-2">{fieldErrors.password}</div> : <div className="mb-3" />}
          <button className="btn btn-info text-white w-100" type="submit" disabled={!token}>{t("auth.resetPassword")}</button>
        </form>
      </div>
    </section>
  );
}
