export function LoadingSkeleton({ rows = 3 }) {
  return (
    <div className="dash-skeleton-wrap" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="dash-skeleton-line" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry, retryLabel = "Retry" }) {
  if (!message) return null;
  return (
    <div className="dash-state-card is-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button className="dash-btn is-secondary is-sm" type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, description, actionLabel, onAction }) {
  return (
    <div className="dash-state-card is-empty">
      <p className="dash-state-title">{title}</p>
      {description ? <p className="dash-state-description">{description}</p> : null}
      {actionLabel && onAction ? (
        <button className="dash-btn is-secondary is-sm" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
