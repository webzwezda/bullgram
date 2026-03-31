export function PlaceholderCard({ title, body }) {
  return (
    <article className="card">
      <div className="card__title">{title}</div>
      <div className="card__body">{body}</div>
    </article>
  );
}
