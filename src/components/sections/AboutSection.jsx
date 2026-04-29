import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function AboutSection({ showProofSections = true }) {
  const { t } = useTranslation();
  const whoWeAre = t("aboutPage.whoWeAre.items", { returnObjects: true, defaultValue: [] });
  const metrics = t("aboutPage.trustMetrics.items", { returnObjects: true, defaultValue: [] });
  const compliance = t("aboutPage.compliance.items", { returnObjects: true, defaultValue: [] });
  const governance = t("aboutPage.governance.items", { returnObjects: true, defaultValue: [] });
  const timeline = t("aboutPage.timeline.items", { returnObjects: true, defaultValue: [] });
  const reliability = t("aboutPage.reliability.items", { returnObjects: true, defaultValue: [] });
  const risks = t("aboutPage.riskDisclosure.items", { returnObjects: true, defaultValue: [] });
  const teamRoles = t("aboutPage.teamAccountability.items", { returnObjects: true, defaultValue: [] });
  const docs = t("aboutPage.docsHub.items", { returnObjects: true, defaultValue: [] });
  const cta = t("aboutPage.cta.actions", { returnObjects: true, defaultValue: [] });
  const contentBands = [
    {
      id: "operations",
      title: t("aboutPage.contentBands.operations.title"),
      lead: t("aboutPage.contentBands.operations.lead"),
      image: "/images/about/about-server-rack-unsplash.jpg",
      imageAlt: t("aboutPage.contentBands.operations.imageAlt"),
      points: [
        whoWeAre[0]?.text,
        whoWeAre[1]?.text,
        timeline[0]?.title ? `${timeline[0].title}: ${timeline[0].text}` : "",
        timeline[1]?.title ? `${timeline[1].title}: ${timeline[1].text}` : "",
      ].filter(Boolean),
    },
    {
      id: "controls",
      title: t("aboutPage.contentBands.controls.title"),
      lead: t("aboutPage.contentBands.controls.lead"),
      image: "/images/about/about-controlroom-unsplash.jpg",
      imageAlt: t("aboutPage.contentBands.controls.imageAlt"),
      reverse: true,
      points: [
        compliance[0]?.title ? `${compliance[0].title}: ${compliance[0].text}` : "",
        compliance[1]?.title ? `${compliance[1].title}: ${compliance[1].text}` : "",
        governance[0],
        governance[1],
      ].filter(Boolean),
    },
    {
      id: "reliability",
      title: t("aboutPage.contentBands.reliability.title"),
      lead: t("aboutPage.contentBands.reliability.lead"),
      image: "/images/about/about-infra-pexels.jpg",
      imageAlt: t("aboutPage.contentBands.reliability.imageAlt"),
      points: [
        reliability[0],
        reliability[1],
        risks[0],
        risks[1],
      ].filter(Boolean),
    },
  ];

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t("sections.aboutTitle")}</h2>
          <p>{t("sections.aboutSubtitle")}</p>
        </div>
        <div className="row about-trust-intro">
          <div className="col-md-6 ">
            <div className="img-box">
              <img src="/images/about-img.png" alt="about" />
            </div>
          </div>
          <div className="col-md-6">
            <div className="detail-box">
              <h3>{t("sections.aboutHeading")}</h3>
              <p>{t("sections.aboutText1")}</p>
              <p>{t("sections.aboutText2")}</p>
              <Link to="/about/cloudmine">{t("cta.readMore")}</Link>
            </div>
          </div>
        </div>

        {showProofSections ? (
          <>
            <div className="about-proof-section">
              <h4>
                <i className="fa fa-bar-chart about-card-icon" aria-hidden="true" />
                {t("aboutPage.trustMetrics.title")}
              </h4>
              <div className="about-proof-grid about-proof-grid-4">
                {metrics.slice(0, 4).map((item) => (
                  <article className="about-metric-tile" key={item.label}>
                    <strong>
                      <i className="fa fa-line-chart about-card-icon" aria-hidden="true" />
                      {item.value}
                    </strong>
                    <span>{item.label}</span>
                  </article>
                ))}
              </div>
            </div>

            {contentBands.map((band) => (
              <div className={`about-proof-section about-content-band ${band.reverse ? "is-reverse" : ""}`} key={band.id}>
                <div className="about-content-band-media">
                  <img src={band.image} alt={band.imageAlt} loading="lazy" />
                </div>
                <div className="about-content-band-body">
                  <h4>{band.title}</h4>
                  <p className="about-proof-lead">{band.lead}</p>
                  <ul className="about-proof-list">
                    {band.points.map((point) => (
                      <li key={`${band.id}_${point}`}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}

            <div className="about-proof-section">
              <h4>
                <i className="fa fa-users about-card-icon" aria-hidden="true" />
                {t("aboutPage.teamAccountability.title")}
              </h4>
              <div className="about-proof-grid about-proof-grid-2">
                {teamRoles.slice(0, 2).map((item) => (
                  <article className="about-proof-card" key={item.role}>
                    <h5>
                      <i className="fa fa-user-circle-o about-card-icon" aria-hidden="true" />
                      {item.role}
                    </h5>
                    <p>{item.sla}</p>
                    <p>{item.owner}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="about-proof-section about-proof-cta">
              <h4>
                <i className="fa fa-folder-open-o about-card-icon" aria-hidden="true" />
                {t("aboutPage.docsHub.title")}
              </h4>
              <div className="about-docs-links">
                {docs.map((item) => (
                  <Link to={item.to} key={item.label} className="about-doc-link">
                    {item.label}
                  </Link>
                ))}
              </div>
              <div className="about-docs-links about-docs-links-cta">
                {cta.map((item) => (
                  <Link to={item.to} key={item.label} className="about-doc-link">
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
