const FALLBACK_CODES = [
  "AE", "AM", "AR", "AT", "AU", "AZ", "BE", "BG", "BH", "BR", "BY", "CA", "CH", "CL", "CN", "CO",
  "CY", "CZ", "DE", "DK", "EE", "EG", "ES", "FI", "FR", "GB", "GE", "GR", "HK", "HR", "HU", "ID",
  "IE", "IL", "IN", "IQ", "IS", "IT", "JO", "JP", "KG", "KR", "KW", "KZ", "LB", "LK", "LT", "LU",
  "LV", "MA", "MD", "ME", "MK", "MT", "MX", "MY", "NL", "NO", "NZ", "OM", "PH", "PL", "PT", "QA",
  "RO", "RS", "RU", "SA", "SE", "SG", "SI", "SK", "TH", "TJ", "TM", "TR", "TW", "UA", "US", "UZ",
  "VN", "ZA",
];

const REQUIRED_COUNTRY_CODES = ["KG", "KZ"];
const COUNTRY_LABEL_OVERRIDES = {
  KG: { en: "Kyrgyzstan", ru: "Кыргызстан" },
  KZ: { en: "Kazakhstan", ru: "Казахстан" },
};

function resolveCodes() {
  try {
    if (typeof Intl?.supportedValuesOf === "function") {
      const supported = Intl.supportedValuesOf("region").filter((code) => /^[A-Z]{2}$/.test(code));
      return [...new Set([...supported, ...REQUIRED_COUNTRY_CODES])];
    }
  } catch {
    // ignore and use fallback
  }
  return [...new Set([...FALLBACK_CODES, ...REQUIRED_COUNTRY_CODES])];
}

export const COUNTRY_CODES = resolveCodes();

export function getCountryDisplayLabels() {
  let english = null;
  let russian = null;
  try {
    english = new Intl.DisplayNames(["en"], { type: "region" });
    russian = new Intl.DisplayNames(["ru"], { type: "region" });
  } catch {
    english = null;
    russian = null;
  }

  return COUNTRY_CODES.reduce((acc, code) => {
    const override = COUNTRY_LABEL_OVERRIDES[code];
    acc[code] = {
      en: override?.en || english?.of(code) || code,
      ru: override?.ru || russian?.of(code) || code,
    };
    return acc;
  }, {});
}

export function detectDefaultCountryCode() {
  const locales = Array.isArray(navigator?.languages) ? navigator.languages : [navigator?.language].filter(Boolean);
  const supported = new Set(COUNTRY_CODES);
  for (const locale of locales) {
    const match = String(locale || "").match(/[-_](\w{2})$/i);
    if (!match) continue;
    const code = match[1].toUpperCase();
    if (supported.has(code)) return code;
  }
  return "";
}

export function filterCountryCodes(query, labels) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return COUNTRY_CODES;
  return COUNTRY_CODES.filter((code) => {
    const data = labels[code] || { en: "", ru: "" };
    return (
      code.toLowerCase().includes(value) ||
      String(data.en).toLowerCase().includes(value) ||
      String(data.ru).toLowerCase().includes(value)
    );
  });
}
