export function ActionCard({ title, value, tone = 'default', hint, href }) {
  const content = (
    <>
      <div className="action-card__head">
        <div className="action-card__title">{title}</div>
        <div className={`action-card__value action-card__value--${tone}`}>{value}</div>
      </div>
      <div className="action-card__hint">{hint}</div>
    </>
  );

  if (!href) {
    return <article className="action-card">{content}</article>;
  }

  return (
    <a className="action-card" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}
