import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../ui/LanguageSwitcher";
import { useAuth } from "../../context/AuthContext";

const navItems = [
  { to: "/", key: "home" },
  { to: "/about", key: "about" },
  { to: "/services", key: "services" },
  { to: "/why-us", key: "whyUs" },
  { to: "/team", key: "team" },
  { to: "/plans", key: "plans" }
];

export function Header() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  useEffect(() => {
    document.body.classList.toggle("mobile-menu-open", open);
    return () => {
      document.body.classList.remove("mobile-menu-open");
    };
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <header className="header_section">
      <div className="container-fluid">
        <nav className="navbar navbar-expand-lg custom_nav-container fintech-header-nav">
          <NavLink className="navbar-brand fintech-brand" to="/">
            <span>{t("brand")}</span>
          </NavLink>

          <button className="navbar-toggler" type="button" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}>
            <span className="" />
          </button>

          <div className={`collapse navbar-collapse ${open ? "show" : ""}`} id="navbarSupportedContent">
            <ul className="navbar-nav">
              {navItems.map((item) => (
                <li className={`nav-item ${location.pathname === item.to ? "active" : ""}`} key={item.to}>
                  <NavLink className="nav-link" to={item.to} onClick={() => setOpen(false)}>
                    {t(`nav.${item.key}`)}
                  </NavLink>
                </li>
              ))}
              {user ? (
                <li className={`nav-item ${location.pathname.startsWith("/dashboard") ? "active" : ""}`}>
                  <NavLink className="nav-link nav-link-cta" to="/dashboard" onClick={() => setOpen(false)}>
                    <i className="fa fa-user" aria-hidden="true" />
                    {t("nav.dashboard")}
                  </NavLink>
                </li>
              ) : null}
              <li className="nav-item fintech-header-auth">
                {user ? (
                  <>
                    <button className="nav-link lang_switcher_btn nav-link-cta is-ghost" type="button" onClick={logout}>
                      {t("nav.logout")}
                    </button>
                  </>
                ) : (
                  <button
                    className="nav-link lang_switcher_btn nav-link-cta"
                    type="button"
                    onClick={() => navigate("/?auth=login")}
                  >
                    {t("nav.login")}
                  </button>
                )}
              </li>
              <li className="nav-item d-flex align-items-center">
                <LanguageSwitcher />
              </li>
            </ul>
          </div>
        </nav>
      </div>
    </header>
  );
}
