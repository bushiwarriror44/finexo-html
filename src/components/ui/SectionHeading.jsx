export function SectionHeading({ title, highlight, subtitle }) {
  return (
    <div className="heading_container heading_center">
      <h2>
        {title} {highlight ? <span>{highlight}</span> : null}
      </h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}
