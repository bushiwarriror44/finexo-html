import { useTranslation } from "react-i18next";
import { FiGlobe } from "react-icons/fi";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const isRu = i18n.language?.startsWith("ru");

  return (
    <button
      className="nav-link lang_switcher_btn lang-switcher-with-icon"
      type="button"
      onClick={() => i18n.changeLanguage(isRu ? "en" : "ru")}
    >
      <FiGlobe className="lang-switcher-icon" aria-hidden="true" />
      <span>{isRu ? "RU" : "EN"}</span>
    </button>
  );
}
