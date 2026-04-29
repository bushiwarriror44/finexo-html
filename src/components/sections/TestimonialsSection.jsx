import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function TestimonialsSection() {
  const { t } = useTranslation();
  const testimonials = t("testimonials", { returnObjects: true, defaultValue: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const safeTestimonials = useMemo(
    () => (Array.isArray(testimonials) ? testimonials : []),
    [testimonials]
  );

  useEffect(() => {
    if (safeTestimonials.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % safeTestimonials.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [safeTestimonials.length]);

  useEffect(() => {
    if (activeIndex >= safeTestimonials.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, safeTestimonials.length]);

  const visibleItems = useMemo(() => {
    if (safeTestimonials.length === 0) return [];
    const first = safeTestimonials[activeIndex];
    const second = safeTestimonials[(activeIndex + 1) % safeTestimonials.length];
    return [first, second];
  }, [activeIndex, safeTestimonials]);

  return (
    <section className="client_section layout_padding">
      <div className="container">
        <div className="heading_container heading_center psudo_white_primary mb_45">
          <h2>{t("sections.testimonialsTitle")}</h2>
        </div>
        {visibleItems.length ? (
          <div className="testimonials_slider">
            <button
              type="button"
              className="testimonial_nav_btn"
              aria-label="Previous testimonial"
              onClick={() =>
                setActiveIndex((prev) => (prev === 0 ? safeTestimonials.length - 1 : prev - 1))
              }
            >
              <span className="testimonial_nav_icon">‹</span>
            </button>
            <div className="testimonials_viewport">
              {visibleItems.map((item, idx) => (
                <article
                  className={`testimonial_card ${idx === 1 ? "is-secondary" : ""}`}
                  key={`${item.name}-${activeIndex}-${idx}`}
                >
                  <div className="testimonial_head">
                    <h6>{item.name}</h6>
                    <p>{item.title}</p>
                  </div>
                  <p className="testimonial_text">{item.text}</p>
                </article>
              ))}
            </div>
            <button
              type="button"
              className="testimonial_nav_btn"
              aria-label="Next testimonial"
              onClick={() => setActiveIndex((prev) => (prev + 1) % safeTestimonials.length)}
            >
              <span className="testimonial_nav_icon">›</span>
            </button>
          </div>
        ) : null}
        <div className="testimonials_dots">
          {safeTestimonials.map((item, index) => (
            <button
              type="button"
              key={`${item.name}-${index}`}
              className={`testimonials_dot ${index === activeIndex ? "is-active" : ""}`}
              onClick={() => setActiveIndex(index)}
              aria-label={`Open testimonial ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
