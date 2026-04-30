const AUTH_ERROR_CODE_TO_KEY = {
  AUTH_REQUIRED_FIELDS: "auth.errors.requiredFields",
  AUTH_WEAK_PASSWORD: "auth.errors.weakPassword",
  AUTH_INVALID_COUNTRY_CODE: "auth.errors.invalidCountry",
  AUTH_USER_EXISTS: "auth.errors.userExists",
  AUTH_INVALID_CREDENTIALS: "auth.errors.invalidCredentials",
  AUTH_USER_INACTIVE: "auth.errors.userInactive",
  AUTH_INVALID_TOKEN: "auth.errors.invalidToken",
  AUTH_TOKEN_EXPIRED: "auth.errors.tokenExpired",
  AUTH_USER_NOT_FOUND: "auth.errors.userNotFound",
  AUTH_EMAIL_SEND_FAILED: "auth.errors.emailSendFailed",
  AUTH_INVALID_EMAIL: "auth.errors.invalidEmail",
  AUTH_CAPTCHA_INVALID: "auth.errors.captchaInvalid",
  NETWORK_ERROR: "auth.errors.network",
};

export function getAuthErrorMessage(error, t, fallbackKey = "auth.errors.requestFailed") {
  const i18nKey = AUTH_ERROR_CODE_TO_KEY[error?.code];
  if (i18nKey) return t(i18nKey);
  if (error?.message) return error.message;
  return t(fallbackKey);
}

const FIELD_CODE_TO_SUFFIX = {
  REQUIRED: "required",
  INVALID: "invalid",
  TOO_SHORT: "tooShort",
  MISSING_UPPERCASE: "missingUppercase",
  MISSING_DIGIT: "missingDigit",
  TAKEN: "taken",
};

export function getAuthFieldErrors(error, t) {
  const fields = error?.details?.fields;
  if (!fields || typeof fields !== "object") return {};
  return Object.entries(fields).reduce((acc, [field, code]) => {
    const suffix = FIELD_CODE_TO_SUFFIX[code] || "invalid";
    const key = `auth.fieldErrors.${field}.${suffix}`;
    acc[field] = t(key, { defaultValue: t("auth.errors.requestFailed") });
    return acc;
  }, {});
}
