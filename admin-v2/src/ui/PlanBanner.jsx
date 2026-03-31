export function PlanBanner({ tone = 'info', title, text }) {
  return (
    <div className={`priority-card priority-card--${tone}`} style={{ marginBottom: 16 }}>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
