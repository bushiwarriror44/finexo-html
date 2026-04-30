import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function AuthCaptcha({ t, value, onChange, onMetaChange, className = "mb-3" }) {
  const [challenge, setChallenge] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [loading, setLoading] = useState(false);

  const refreshCaptcha = async () => {
    setLoading(true);
    try {
      const data = await apiGet("/api/auth/captcha");
      setChallenge(String(data?.challenge || ""));
      setCaptchaId(String(data?.captchaId || ""));
      onMetaChange?.({ captchaId: String(data?.captchaId || "") });
    } catch {
      setChallenge("");
      setCaptchaId("");
      onMetaChange?.({ captchaId: "" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <label className="d-block mb-2">{t("auth.captchaLabel", { defaultValue: "Captcha" })}</label>
      <div className="d-flex gap-2 mb-2 align-items-center">
        <div className="form-control bg-light" aria-live="polite" style={{ fontWeight: 600 }}>
          {loading ? t("auth.captchaLoading", { defaultValue: "Loading..." }) : challenge || "—"}
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={refreshCaptcha} disabled={loading}>
          {t("auth.captchaRefresh", { defaultValue: "Refresh" })}
        </button>
      </div>
      <input
        className="form-control"
        type="text"
        inputMode="numeric"
        placeholder={t("auth.captchaPlaceholder", { defaultValue: "Enter result" })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <input type="hidden" value={captchaId} readOnly />
    </div>
  );
}
