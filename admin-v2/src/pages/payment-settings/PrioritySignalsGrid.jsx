export function PrioritySignalsGrid({ signals }) {
  if (signals.length === 0) return null;

  return (
    <div className="priority-grid section">
      {signals.map((signal) => (
        <article key={signal.title} className={`priority-card priority-card--${signal.tone}`}>
          <h3>{signal.title}</h3>
          <p>{signal.text}</p>
        </article>
      ))}
    </div>
  );
}
