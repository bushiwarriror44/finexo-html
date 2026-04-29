import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

const STRATEGY_KEYS = ["btc-pool-contracts", "security-storage", "expert-support"];

export function ServiceStrategyPage() {
  const { strategyId = "" } = useParams();
  const { t } = useTranslation();

  if (!STRATEGY_KEYS.includes(strategyId)) {
    return <Navigate to="/services" replace />;
  }

  const baseKey = `serviceStrategies.${strategyId}`;
  const points = t(`${baseKey}.points`, { returnObjects: true, defaultValue: [] });
  const blocks = t(`${baseKey}.blocks`, { returnObjects: true, defaultValue: [] });

  return (
    <section className="about_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t(`${baseKey}.title`)}</h2>
          <p>{t(`${baseKey}.subtitle`)}</p>
        </div>

        <p className="text-center mb-4">{t(`${baseKey}.intro`)}</p>

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

        <div className="box mb-4">
          <div className="detail-box">
            <h5>{t(`${baseKey}.forWhomTitle`)}</h5>
            <ul className="services-proof-list">
              {points.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-center mb-3">{t(`${baseKey}.outro`)}</p>

        <div className="text-center">
          <Link className="dash-btn is-secondary" to="/services">
            {t("dashboardCabinet.actions.back", { defaultValue: "Back" })}
          </Link>
        </div>
      </div>
    </section>
  );
}
