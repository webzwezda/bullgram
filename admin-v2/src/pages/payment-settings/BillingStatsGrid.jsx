import { StatCard } from '../../ui/StatCard.jsx';

export function BillingStatsGrid({ cards }) {
  return (
    <div className="grid">
      {cards.map((card) => (
        <StatCard key={card.title} title={card.title} value={card.value} hint={card.hint} tone={card.tone} />
      ))}
    </div>
  );
}
