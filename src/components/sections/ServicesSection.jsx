import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { servicesData } from "../../data/servicesData";

export function ServicesSection({ showProofSections = true }) {
  const { t } = useTranslation();
  const controlsByService = t("servicesPage.controlsByService.items", { returnObjects: true, defaultValue: [] });
  const timeline = t("servicesPage.timeline.items", { returnObjects: true, defaultValue: [] });
  const policyLinks = t("servicesPage.policyHub.links", { returnObjects: true, defaultValue: [] });
  const trustCta = t("servicesPage.trustCta.actions", { returnObjects: true, defaultValue: [] });
  const contentBands = [
    {
      id: "operations",
      title: t("servicesPage.contentBands.operations.title"),
      lead: t("servicesPage.contentBands.operations.lead"),
      image: "/images/services/services-operations-pexels.jpg",
      imageAlt: t("servicesPage.contentBands.operations.imageAlt"),
      points: [
        controlsByService[0]?.controls?.[0],
        controlsByService[0]?.controls?.[1],
        timeline[0]?.stage ? `${timeline[0].stage}: ${timeline[0].text}` : "",
        timeline[2]?.stage ? `${timeline[2].stage}: ${timeline[2].text}` : "",
      ].filter(Boolean),
    },
    {
      id: "controls",
      title: t("servicesPage.contentBands.controls.title"),
      lead: t("servicesPage.contentBands.controls.lead"),
      image: "/images/services/services-controlroom-pexels.jpg",
      imageAlt: t("servicesPage.contentBands.controls.imageAlt"),
      reverse: true,
      points: [
        controlsByService[1]?.controls?.[0],
        controlsByService[1]?.controls?.[1],
        controlsByService[2]?.controls?.[0],
        controlsByService[2]?.controls?.[1],
      ].filter(Boolean),
    },
    {
      id: "economics",
      title: t("servicesPage.contentBands.economics.title"),
      lead: t("servicesPage.contentBands.economics.lead"),
      image: "/images/services/services-incident-pexels.jpg",
      imageAlt: t("servicesPage.contentBands.economics.imageAlt"),
      points: [
        timeline[1]?.stage ? `${timeline[1].stage}: ${timeline[1].text}` : "",
        timeline[3]?.stage ? `${timeline[3].stage}: ${timeline[3].text}` : "",
        t("servicesSeo.trustText"),
      ].filter(Boolean),
    },
  ];

  return (
    <section className="service_section layout_padding">
      <div className="service_container">
        <div className="container">
          <div className="heading_container heading_center">
            <h2>{t("sections.servicesTitle")}</h2>
            <p>{t("sections.servicesSubtitle")}</p>
          </div>
          <p className="services-seo-lead">{t("servicesSeo.lead")}</p>
          <div className="services-seo-tags" aria-label={t("servicesSeo.tagsLabel")}>
            <span>{t("servicesSeo.tagUptime")}</span>
            <span>{t("servicesSeo.tagFees")}</span>
            <span>{t("servicesSeo.tagPayouts")}</span>
            <span>{t("servicesSeo.tagSupport")}</span>
          </div>
          <div className="row">
            {servicesData.map((service) => (
              <div className="col-md-4" key={service.title}>
                <div className="box">
                  <div className="img-box"><img src={service.icon} alt={service.title} /></div>
                  <div className="detail-box">
                    <h5>{service.title}</h5>
                    <p>{service.text}</p>
                    <Link to={`/services/${service.id}`}>{t("cta.readMore")}</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="services-seo-trust">{t("servicesSeo.trustText")}</p>
          <div className="btn-box"><Link to="/services">{t("cta.viewAll")}</Link></div>

          {showProofSections ? (
            <>
          {contentBands.map((band) => (
            <div className={`services-proof-section services-content-band ${band.reverse ? "is-reverse" : ""}`} key={band.id}>
              <div className="services-content-band-media">
                <img src={band.image} alt={band.imageAlt} loading="lazy" />
              </div>
              <div className="services-content-band-body">
                <h4>{band.title}</h4>
                <p className="services-proof-lead">{band.lead}</p>
                <ul className="services-proof-list">
                  {band.points.map((point) => (
                    <li key={`${band.id}_${point}`}>{point}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}

          <div className="services-proof-section">
            <h4>
              <i className="fa fa-clock-o services-section-icon" aria-hidden="true" />
              {t("servicesPage.timeline.title")}
            </h4>
            <div className="services-timeline-grid">
              {timeline.map((item, index) => (
                <article className="services-timeline-step" key={item.stage}>
                  <span className="services-timeline-index">{index + 1}</span>
                  <h5>{item.stage}</h5>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="services-proof-section">
            <h4>
              <i className="fa fa-folder-open-o services-section-icon" aria-hidden="true" />
              {t("servicesPage.policyHub.title")}
            </h4>
            <div className="services-docs-links">
              {policyLinks.map((link) => (
                <Link to={link.to} className="services-doc-link" key={link.label}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="services-proof-section services-proof-cta">
            <h4>
              <i className="fa fa-check-circle-o services-section-icon" aria-hidden="true" />
              {t("servicesPage.trustCta.title")}
            </h4>
            <div className="services-docs-links">
              {trustCta.map((action) => (
                <Link to={action.to} className="services-doc-link" key={action.label}>
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
