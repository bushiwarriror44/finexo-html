import { FiArrowRight } from "react-icons/fi";

export function ActionPopupCard({ icon: Icon, title, description, ctaLabel, onClick, tone = "primary" }) {
  return (
    <button type="button" className={`action-popup-card is-${tone}`} onClick={onClick}>
      <span className="action-popup-icon">{Icon ? <Icon /> : null}</span>
      <span className="action-popup-content">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </span>
      <span className="action-popup-cta">
        {ctaLabel}
        <FiArrowRight />
      </span>
    </button>
  );
}
