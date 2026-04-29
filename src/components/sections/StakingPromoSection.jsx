import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiGet } from "../../api/client";

export function StakingPromoSection() {
  const { t } = useTranslation();
  const [tiers, setTiers] = useState([]);

  useEffect(() => {
    let active = true;
    apiGet("/api/user/staking/tiers")
      .then((data) => {
        if (!active) return;
        setTiers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setTiers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const fallbackTiers = [
    { id: "f1", minAmount: 900, maxAmount: 9900, dailyRate: 0.01, isHotOffer: true },
    { id: "f2", minAmount: 10000, maxAmount: 19900, dailyRate: 0.013, isHotOffer: true },
    { id: "f3", minAmount: 20000, maxAmount: 29900, dailyRate: 0.015, isHotOffer: true },
    { id: "f4", minAmount: 30000, maxAmount: 39990, dailyRate: 0.016, isHotOffer: true },
  ];
  const visibleTiers = tiers.length ? tiers : fallbackTiers;

  return (
    <section className="staking_promo_section layout_padding-bottom">
      <div className="container">
        <div className="heading_container heading_center">
          <h2>{t("stakingPromo.title", { defaultValue: "USDT Staking Hot Action" })}</h2>
          <p>{t("stakingPromo.lead", { defaultValue: "Choose a fixed USDT tier and receive hourly credited staking profit to your main balance." })}</p>
        </div>
        <div className="staking_promo_grid">
          {visibleTiers.map((tier) => (
            <article className="staking_promo_card" key={tier.id}>
              <img src="/images/crypto/usdt-circle.svg" alt="USDT token" loading="lazy" />
              {tier.isHotOffer ? <span className="staking_hot_badge">{t("stakingPromo.hot", { defaultValue: "Hot action" })}</span> : null}
              <h5>{Number(tier.minAmount).toLocaleString()} - {Number(tier.maxAmount).toLocaleString()} USDT</h5>
              <p>{(Number(tier.dailyRate) * 100).toFixed(1)}% / {t("stakingPromo.day", { defaultValue: "day" })}</p>
              <Link className="btn-box" to="/dashboard/staking">
                {t("stakingPromo.invest", { defaultValue: "Invest" })}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
