import { useTranslation } from "react-i18next";

export function AboutReadMorePage() {
  const { t } = useTranslation();
  const blocks = t("aboutReadMore.blocks", { returnObjects: true, defaultValue: [] });
  const intro = t("aboutReadMore.intro");
  const outro = t("aboutReadMore.outro");

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t("aboutReadMore.title")}</h2>
          <p>{t("aboutReadMore.subtitle")}</p>
        </div>
        <p className="text-center mb-4">{intro}</p>
        <div className="row">
          {blocks.map((block, index) => (
            <div className="col-lg-4 col-md-6 mb-4" key={`${block.heading}-${index}`}>
              <div className="box h-100">
                <div className="detail-box">
                  <h5>{block.heading}</h5>
                  <p>{block.text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center mb-0">{outro}</p>
      </div>
    </section>
  );
}
