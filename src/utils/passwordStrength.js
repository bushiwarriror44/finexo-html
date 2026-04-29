const UPPER_RE = /[A-Z]/;
const DIGIT_RE = /\d/;

export function getPasswordChecks(password) {
  const value = String(password || "");
  return {
    minLength: value.length >= 8,
    hasUppercase: UPPER_RE.test(value),
    hasDigit: DIGIT_RE.test(value),
  };
}

export function getPasswordStrength(password) {
  const checks = getPasswordChecks(password);
  const passed = Object.values(checks).filter(Boolean).length;
  const percent = Math.round((passed / 3) * 100);
  let tone = "danger";
  if (passed === 2) tone = "warning";
  if (passed === 3) tone = "success";
  return { checks, passed, percent, tone };
}
