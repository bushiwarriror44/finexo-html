import { useTranslation } from "react-i18next";

export function WhySection() {
  const { t } = useTranslation();
  const items = t("whyItems", { returnObjects: true });

  return (
    <section className="why_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t("sections.whyTitle")}</h2>
        </div>
        <div className="why_container">
          {items.map((item, index) => (
            <div className="box" key={item.title}>
              <div className="img-box"><img src={`/images/w${index + 1}.png`} alt={item.title} /></div>
              <div className="detail-box">
                <h5>{item.title}</h5>
                <p>{item.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="btn-box"><a href="#">{t("cta.readMore")}</a></div>
      </div>
    </section>
  );
}
