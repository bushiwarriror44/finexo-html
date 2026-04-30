import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function AuthCaptcha({ t, value, onChange, onMetaChange, className = "mb-3" }) {
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const refreshCaptcha = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/api/auth/captcha");
      const nextImage = String(data?.captchaImage || "");
      const nextId = String(data?.captchaId || "");
      setCaptchaImage(nextImage);
      setCaptchaId(nextId);
      setLoadError(nextImage && nextId ? "" : t("auth.captchaLoadFailed", { defaultValue: "Failed to load captcha" }));
      onMetaChange?.({ captchaId: nextId });
    } catch {
      setCaptchaImage("");
      setCaptchaId("");
      setLoadError(t("auth.captchaLoadFailed", { defaultValue: "Failed to load captcha" }));
      onMetaChange?.({ captchaId: "" });
    } finally {
      setLoading(false);
    }
  }, [onMetaChange, t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshCaptcha();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshCaptcha]);

  return (
    <div className={className}>
      <label className="d-block mb-2">{t("auth.captchaLabel", { defaultValue: "Captcha" })}</label>
      <div className="d-flex gap-2 mb-2 align-items-center">
        <div
          className="form-control bg-light d-flex align-items-center justify-content-center"
          aria-live="polite"
          style={{ minHeight: 56 }}
        >
          {loading ? (
            <span>{t("auth.captchaLoading", { defaultValue: "Loading..." })}</span>
          ) : captchaImage ? (
            <img
              src={captchaImage}
              alt={t("auth.captchaLabel", { defaultValue: "Captcha" })}
              style={{ maxWidth: "100%", maxHeight: 46, width: "100%", objectFit: "contain" }}
            />
          ) : (
            <span>{loadError || t("auth.captchaUnavailable", { defaultValue: "Captcha unavailable" })}</span>
          )}
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
