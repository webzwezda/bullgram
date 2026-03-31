export function StatCard({ title, value, tone = 'default', hint }) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__title">{title}</div>
      <div className="stat-card__value">{value}</div>
      {hint ? <div className="stat-card__hint">{hint}</div> : null}
    </article>
  );
}
