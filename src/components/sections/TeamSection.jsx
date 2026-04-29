import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { apiPost } from "../../api/client";
import { teamData } from "../../data/teamData";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function TeamSection({ showProofSections = true }) {
  const { t } = useTranslation();
  const location = useLocation();
  const showStoryBlock = location.pathname === "/team";
  const contentBands = [
    {
      id: "operations",
      title: t("teamPage.contentBands.operations.title"),
      lead: t("teamPage.contentBands.operations.lead"),
      image: "/images/team/team-ops-pexels.jpg",
      imageAlt: t("teamPage.contentBands.operations.imageAlt"),
      points: [
        t("teamPage.roleMatrix.items.operations.scope"),
        t("teamPage.roleMatrix.items.support.scope"),
        t("teamStory.paragraphs.0"),
      ],
    },
    {
      id: "controls",
      title: t("teamPage.contentBands.controls.title"),
      lead: t("teamPage.contentBands.controls.lead"),
      image: "/images/team/team-governance-pexels.jpg",
      imageAlt: t("teamPage.contentBands.controls.imageAlt"),
      reverse: true,
      points: [
        t("teamPage.roleMatrix.items.compliance.scope"),
        t("teamPage.roleMatrix.items.security.scope"),
        t("teamStory.paragraphs.1"),
      ],
    },
  ];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    role: "",
    experience: "",
    message: "",
  });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setStatus("");
    const normalizedEmail = (form.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError(t("teamApply.invalidEmail"));
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/user/team-applications", {
        fullName: form.fullName.trim(),
        email: normalizedEmail,
        role: form.role.trim(),
        experience: form.experience.trim(),
        message: form.message.trim(),
      });
      setStatus(t("teamApply.success"));
      setForm({
        fullName: "",
        email: "",
        role: "",
        experience: "",
        message: "",
      });
      setTimeout(() => setOpen(false), 1200);
    } catch (err) {
      setError(err.message || t("teamApply.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="team_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2 className=" ">{t("sections.teamTitle")}</h2>
        </div>
        {showProofSections ? (
        <div className="team_container">
          {contentBands.map((band) => (
            <div className={`team-proof-section team-content-band ${band.reverse ? "is-reverse" : ""}`} key={band.id}>
              <div className="team-content-band-media">
                <img src={band.image} alt={band.imageAlt} loading="lazy" />
              </div>
              <div className="team-content-band-body">
                <h4>{band.title}</h4>
                <p className="team-proof-lead">{band.lead}</p>
                <ul className="team-proof-list">
                  {band.points.map((point) => (
                    <li key={`${band.id}_${point}`}>{point}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}

          <div className="team-proof-section">
            <h4>{t("teamPage.roleMatrix.title")}</h4>
            <p className="team-proof-lead">{t("teamPage.roleMatrix.lead")}</p>
            <div className="row">
              {teamData.map((roleMeta) => (
                <div className="col-lg-3 col-sm-6" key={roleMeta.id}>
                  <div className="team-role-card">
                    <div className="team-role-icon" aria-hidden="true">
                      <i className={`fa ${roleMeta.icon}`} />
                    </div>
                    <div className="detail-box">
                      <h5>{t(`teamPage.roleMatrix.items.${roleMeta.id}.role`)}</h5>
                      <p className="team-role-owner">{t(`teamPage.roleMatrix.items.${roleMeta.id}.owner`)}</p>
                      <p>{t(`teamPage.roleMatrix.items.${roleMeta.id}.scope`)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        ) : null}
        <div className="team-contact-block">
          <div className="row">
            <div className="col-lg-5">
              <div className="team-contact-card">
                <h4>{t("teamContact.title")}</h4>
                <p className="team-contact-subtitle">{t("teamContact.subtitle")}</p>
                <p className="team-contact-item">
                  <strong>{t("teamContact.addressLabel")}:</strong> {t("teamContact.addressValue")}
                </p>
                <p className="team-contact-item">
                  <strong>{t("teamContact.emailLabel")}:</strong>{" "}
                  <a href={`mailto:${t("teamContact.emailValue")}`}>{t("teamContact.emailValue")}</a>
                </p>
                <p className="team-contact-item">
                  <strong>{t("teamContact.phoneLabel")}:</strong>{" "}
                  <a href="tel:+971400123456">{t("teamContact.phoneValue")}</a>
                </p>
                <p className="team-contact-item mb-0">
                  <strong>{t("teamContact.hotlineLabel")}:</strong>{" "}
                  <a href="tel:+971400987654">{t("teamContact.hotlineValue")}</a>
                </p>
              </div>
            </div>
            <div className="col-lg-7">
              <div className="team-map-wrap">
                <iframe
                  title={t("teamContact.mapTitle")}
                  src="https://maps.google.com/maps?q=Downtown%20Dubai%20Business%20Center&t=&z=14&ie=UTF8&iwloc=&output=embed"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        </div>
        {showStoryBlock ? (
          <div className="team-story-block">
            <h4>{t("teamStory.title")}</h4>
            {(t("teamStory.paragraphs", { returnObjects: true, defaultValue: [] }) || []).map((text, idx) => (
              <p key={`team-story-${idx}`}>{text}</p>
            ))}
          </div>
        ) : null}
        <div className="team_cta_wrap">
          <button className="team_cta_btn" type="button" onClick={() => setOpen(true)}>
            {t("teamApply.cta")}
          </button>
        </div>
      </div>
      {open ? (
        <div className="team-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="team-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button className="team-modal-close" type="button" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
            <h4>{t("teamApply.title")}</h4>
            <p className="team-modal-subtitle">{t("teamApply.subtitle")}</p>
            <form className="team-modal-form" onSubmit={submit}>
              <input
                className="form-control"
                type="text"
                placeholder={t("teamApply.fullName")}
                value={form.fullName}
                onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                required
              />
              <input
                className="form-control"
                type="email"
                placeholder={t("teamApply.email")}
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                required
              />
              <input
                className="form-control"
                type="text"
                placeholder={t("teamApply.role")}
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                required
              />
              <input
                className="form-control"
                type="text"
                placeholder={t("teamApply.experience")}
                value={form.experience}
                onChange={(e) => setForm((prev) => ({ ...prev, experience: e.target.value }))}
                required
              />
              <textarea
                className="form-control"
                rows="4"
                placeholder={t("teamApply.message")}
                value={form.message}
                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
              />
              {error ? <p className="text-warning mb-0">{error}</p> : null}
              {status ? <p className="text-info mb-0">{status}</p> : null}
              <button className="btn btn-info text-white w-100" type="submit" disabled={submitting}>
                {t("teamApply.submit")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
