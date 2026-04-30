import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function HeroSection() {
  const { t } = useTranslation();
  const slides = useMemo(
    () =>
      t("hero.slides", {
        returnObjects: true,
        defaultValue: [],
      }),
    [t]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const safeSlides = Array.isArray(slides) ? slides : [];
  const normalizedActiveIndex = safeSlides.length === 0 ? 0 : activeIndex % safeSlides.length;

  useEffect(() => {
    if (safeSlides.length < 2) return undefined;
    const interval = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % safeSlides.length);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [safeSlides.length]);

  return (
    <section className="slider_section">
      <div id="customCarousel1" className="carousel slide">
        <div className="carousel-inner">
          {safeSlides.map((slide, index) => (
            <div
              className={`carousel-item ${index === normalizedActiveIndex ? "active" : ""}`}
              key={`${slide.title}-${index}`}
            >
              <div className="container ">
                <div className="row">
                  <div className="col-md-6 ">
                    <div className="detail-box">
                      <h1>{slide.title}</h1>
                      <p>{slide.text}</p>
                      <div className="btn-box">
                        <Link to="/plans" className="btn1">
                          {t("hero.ctaPrimary")}
                        </Link>
                        <Link to="/#profitability-calculator" className="btn1">
                          {t("hero.ctaSecondary")}
                        </Link>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="img-box">
                      <img src="/images/slider-img.png" alt="slider" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <ol className="carousel-indicators">
          {safeSlides.map((slide, index) => (
            <li
              key={`indicator-${slide.title}-${index}`}
              className={index === normalizedActiveIndex ? "active" : ""}
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
