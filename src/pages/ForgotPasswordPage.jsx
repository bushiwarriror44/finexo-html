import { useState } from "react";
import { apiPost } from "../api/client";
import { useTranslation } from "react-i18next";
import { getAuthErrorMessage, getAuthFieldErrors } from "../utils/authErrorI18n";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setStatus("");
    try {
      await apiPost("/api/auth/forgot-password", {
        email,
        frontendUrl: `${window.location.origin}/reset-password`,
      });
      setStatus(t("auth.resetSent"));
    } catch (err) {
      setFieldErrors(getAuthFieldErrors(err, t));
      setError(getAuthErrorMessage(err, t));
    }
  };

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center"><h2>{t("auth.passwordRecovery")}</h2></div>
        <form onSubmit={onSubmit} className="mx-auto" style={{ maxWidth: 420 }}>
          {error ? <p className="text-warning">{error}</p> : null}
          {status ? <p className="text-info">{status}</p> : null}
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
          <button className="btn btn-info text-white w-100" type="submit">{t("auth.sendResetLink")}</button>
        </form>
      </div>
    </section>
  );
}
