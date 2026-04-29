import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const onSubscribe = (e) => {
    e.preventDefault();
    const normalized = (email || "").trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalized);
    if (!emailOk) {
      setError(t("footer.invalidEmail"));
      return;
    }
    setError("");
    setShowSuccess(true);
    setEmail("");
  };

  const socialLinks = {
    facebook: "https://www.facebook.com/",
    twitter: "https://x.com/",
    linkedin: "https://www.linkedin.com/",
    instagram: "https://www.instagram.com/",
  };

  return (
    <>
      <section className="info_section layout_padding2">
        <div className="container">
          <div className="row">
            <div className="col-md-6 col-lg-3 info_col">
              <div className="info_contact">
                <h4>{t("footer.address")}</h4>
                <div className="contact_link_box">
                  <a href="https://maps.google.com/?q=Dubai,UAE" target="_blank" rel="noreferrer"><i className="fa fa-map-marker" aria-hidden="true" /><span>{t("footer.location")}</span></a>
                  <a href="tel:+971000000000"><i className="fa fa-phone" aria-hidden="true" /><span>{t("footer.call")}</span></a>
                  <a href="mailto:support@cloudmine.io"><i className="fa fa-envelope" aria-hidden="true" /><span>{t("footer.email")}</span></a>
                </div>
              </div>
              <div className="info_social">
                <a href={socialLinks.facebook} target="_blank" rel="noreferrer" aria-label="Facebook"><i className="fa fa-facebook" aria-hidden="true" /></a>
                <a href={socialLinks.twitter} target="_blank" rel="noreferrer" aria-label="Twitter"><i className="fa fa-twitter" aria-hidden="true" /></a>
                <a href={socialLinks.linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn"><i className="fa fa-linkedin" aria-hidden="true" /></a>
                <a href={socialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Instagram"><i className="fa fa-instagram" aria-hidden="true" /></a>
              </div>
            </div>
            <div className="col-md-6 col-lg-3 info_col">
              <div className="info_detail">
                <h4>{t("footer.info")}</h4>
                <p>{t("footer.infoText")}</p>
              </div>
            </div>
            <div className="col-md-6 col-lg-2 mx-auto info_col">
              <div className="info_link_box">
                <h4>{t("footer.links")}</h4>
                <div className="info_links">
                  <NavLink to="/">{t("nav.home")}</NavLink>
                  <NavLink to="/about">{t("nav.about")}</NavLink>
                  <NavLink to="/services">{t("nav.services")}</NavLink>
                  <NavLink to="/why-us">{t("nav.whyUs")}</NavLink>
                  <NavLink to="/team">{t("nav.team")}</NavLink>
                  <NavLink to="/aml-policy">{t("footer.amlPolicy")}</NavLink>
                  <NavLink to="/terms">{t("footer.terms")}</NavLink>
                  <NavLink to="/privacy-policy">{t("footer.privacyPolicy", { defaultValue: "Privacy Policy" })}</NavLink>
                  <NavLink to="/cookie-policy">{t("footer.cookiePolicy", { defaultValue: "Cookie Policy" })}</NavLink>
                </div>
              </div>
            </div>
            <div className="col-md-6 col-lg-3 info_col ">
              <h4>{t("footer.subscribe")}</h4>
              <form onSubmit={onSubscribe}>
                <input
                  type="text"
                  placeholder={t("footer.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="submit">{t("footer.subscribe")}</button>
              </form>
              {error ? <p className="footer-subscribe-error">{error}</p> : null}
            </div>
          </div>
        </div>
      </section>
      <section className="footer_section">
        <div className="container">
          <p>&copy; {year} {t("footer.rights")} CloudMine</p>
        </div>
      </section>
      {showSuccess ? (
        <div className="auth-modal-backdrop" onClick={() => setShowSuccess(false)}>
          <div className="auth-modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="auth-modal-close" type="button" onClick={() => setShowSuccess(false)} aria-label="Close">
              ×
            </button>
            <h3 className="auth-modal-title">{t("footer.subscribeSuccessTitle")}</h3>
            <p className="mb-3">{t("footer.subscribeSuccessText")}</p>
            <button className="btn btn-info text-white w-100" type="button" onClick={() => setShowSuccess(false)}>
              {t("footer.subscribeSuccessOk")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
