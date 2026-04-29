import { useTranslation } from "react-i18next";

export function TermsPage() {
  const { t } = useTranslation();
  const sections = t("terms.sections", { returnObjects: true, defaultValue: [] });

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t("terms.title")}</h2>
          <p>{t("terms.updatedAt")}</p>
        </div>
        <div className="row">
          <div className="col-12">
            {sections.map((section, index) => (
              <div className="box mb-4" key={`${section.heading}-${index}`}>
                <div className="detail-box">
                  <h5>{section.heading}</h5>
                  <p>{section.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
