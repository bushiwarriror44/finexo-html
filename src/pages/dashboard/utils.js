export function statusBadgeClass(value) {
  const status = String(value || "").toLowerCase();
  if (["completed", "approved", "done", "success", "settled"].includes(status)) return "dash-badge is-success";
  if (["rejected", "cancelled", "failed", "error", "expired"].includes(status)) return "dash-badge is-danger";
  if (["processing", "running", "review", "under_review"].includes(status)) return "dash-badge is-info";
  if (["pending", "queued", "submitted", "new"].includes(status)) return "dash-badge is-warning";
  return "dash-badge is-muted";
}

export function money(value, digits = 4) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `$${Number(0).toFixed(digits)}`;
  return `$${amount.toFixed(digits)}`;
}

export function shortenHash(value, head = 10, tail = 8) {
  const text = String(value || "");
  if (!text) return "-";
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

export function normalizeApiList(value) {
  return Array.isArray(value) ? value : [];
}

export function getSafeErrorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

export function isPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function formatLastUpdatedLabel(timestamp, t, options = {}) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  const secondsAgo = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const shortAgo =
    secondsAgo < 60
      ? `${secondsAgo}s ago`
      : secondsAgo < 3600
      ? `${Math.floor(secondsAgo / 60)}m ago`
      : `${Math.floor(secondsAgo / 3600)}h ago`;
  if (options.withRelativeHint === false) return date.toLocaleTimeString();
  return `${date.toLocaleTimeString()} (${t(options.relativeKey || "dashboardCabinet.lastUpdatedAgo", { defaultValue: shortAgo, value: shortAgo })})`;
}

export async function copyTextWithFeedback(text, { onSuccess, onError } = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    if (onError) onError("nothing to copy");
    return false;
  }
  try {
    await navigator.clipboard?.writeText(normalized);
    if (onSuccess) onSuccess();
    return true;
  } catch (err) {
    if (onError) onError(err?.message || "copy failed");
    return false;
  }
}
