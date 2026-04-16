import { formatWhen } from './payment-settings.utils.js';

export function BillingHeader({ pageCopy, refreshing, updatedAt }) {
  return (
    <div className="page__header">
      <h1>{pageCopy.title}</h1>
      <p>{pageCopy.description}</p>
      <div className="page__meta">
        <span>Последнее обновление: {formatWhen(updatedAt)}</span>
        <span>{refreshing ? 'Обновляем фон...' : pageCopy.refreshHint}</span>
      </div>
    </div>
  );
}
