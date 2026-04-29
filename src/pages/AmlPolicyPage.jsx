import { useTranslation } from "react-i18next";

export function AmlPolicyPage() {
  const { t } = useTranslation();
  const sections = t("amlPolicy.sections", { returnObjects: true, defaultValue: [] });

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t("amlPolicy.title")}</h2>
          <p>{t("amlPolicy.updatedAt")}</p>
        </div>
        <p className="text-center mb-4">{t("amlPolicy.intro")}</p>
        <div className="row">
          {sections.map((item, index) => (
            <div className="col-lg-6 mb-4" key={`${item.heading}-${index}`}>
              <div className="box h-100">
                <div className="detail-box">
                  <h5>{item.heading}</h5>
                  <p>{item.text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center mb-0">{t("amlPolicy.outro")}</p>
      </div>
    </section>
  );
}
