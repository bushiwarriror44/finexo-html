const API_BASE = "";

function createApiError(message, context = {}) {
  const error = new Error(message || "Request failed");
  error.code = context.code || "UNKNOWN_ERROR";
  error.status = context.status || 0;
  error.details = context.details || null;
  return error;
}

function isJsonResponse(response) {
  return String(response.headers.get("content-type") || "").includes("application/json");
}

async function parseResponse(response) {
  const data = isJsonResponse(response) ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    throw createApiError(data.error || data.message || `Request failed (${response.status})`, {
      code: data.code,
      status: response.status,
      details: data.details || data,
    });
  }
  return data;
}

async function request(url, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${url}`, { credentials: "include", ...options });
    return parseResponse(response);
  } catch (error) {
    if (error instanceof TypeError) {
      throw createApiError("Network error. Please check your connection and try again.", {
        code: "NETWORK_ERROR",
      });
    }
    throw error;
  }
}

export async function apiGet(url) {
  return request(url);
}

export async function apiPost(url, payload) {
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export async function apiPostForm(url, formData) {
  return request(url, {
    method: "POST",
    body: formData,
  });
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
