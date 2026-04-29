import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { plansData } from "../data/plansData";
import { SectionHeading } from "../components/ui/SectionHeading";

export function CalculatorPage() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(1000);
  const [planRoi, setPlanRoi] = useState(plansData[0].roi);
  const projected = useMemo(() => (amount * planRoi) / 100, [amount, planRoi]);

  return (
    <section className="about_section layout_padding calculator_page">
      <div className="container">
        <SectionHeading title={t("sections.calculatorTitle")} />
        <div className="row">
          <div className="col-md-6">
            <div className="detail-box">
              <label className="d-block mb-2">{t("calculator.amount")}</label>
              <input className="form-control mb-3" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value || 0))} />
              <label className="d-block mb-2">{t("calculator.plan")}</label>
              <select className="form-control" onChange={(e) => setPlanRoi(Number(e.target.value))} value={planRoi}>
                {plansData.map((plan) => (
                  <option key={plan.name} value={plan.roi}>
                    {plan.name} ({plan.roi}%)
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="col-md-6">
            <div className="box">
              <div className="detail-box">
                <h5>{t("calculator.profit")}</h5>
                <h3>${projected.toFixed(2)}</h3>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
