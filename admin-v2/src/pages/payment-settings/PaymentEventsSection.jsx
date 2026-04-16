import { PAYMENT_EVENT_FILTERS } from './payment-settings.constants.js';
import {
  downloadCsv,
  formatWhen,
  paymentEventBadge
} from './payment-settings.utils.js';

export function PaymentEventsSection({
  filteredPaymentEvents,
  paymentEventFilter,
  setPaymentEventFilter
}) {
  return (
    <div className="table-card">
      <div className="table-card__title">Последние события кассы</div>
      <div className="filter-strip">
        {PAYMENT_EVENT_FILTERS.map((item) => (
          <button
            key={item.id}
            className={`filter-chip${paymentEventFilter === item.id ? ' filter-chip--active' : ''}`}
            onClick={() => setPaymentEventFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="table-actions" style={{ marginTop: 12, marginBottom: 12 }}>
        <button
          className="inline-action"
          onClick={() => downloadCsv(
            `payment-events-${new Date().toISOString().slice(0, 10)}.csv`,
            ['created_at', 'provider', 'event_type', 'status', 'invoice_id'],
            filteredPaymentEvents.map((event) => [
              event.created_at,
              event.provider,
              event.event_type,
              event.status,
              event.invoice_id
            ])
          )}
        >
          Журнал CSV
        </button>
      </div>
      {filteredPaymentEvents.length === 0 ? (
        <div className="empty-inline">Пока событий нет. Как только касса начнет стучать webhook-ами, они появятся здесь.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Провайдер</th>
              <th>Событие</th>
              <th>Статус</th>
              <th>Invoice</th>
              <th>Дальше</th>
            </tr>
          </thead>
          <tbody>
            {filteredPaymentEvents.map((event) => {
              const badge = paymentEventBadge(event);
              return (
                <tr key={event.id}>
                  <td>{formatWhen(event.created_at)}</td>
                  <td>{event.provider}</td>
                  <td><span className={badge.className}>{badge.text}</span></td>
                  <td>{event.status || '—'}</td>
                  <td>{event.invoice_id || '—'}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="inline-action"
                        onClick={() => {
                          window.localStorage.setItem('orders_search_preset', JSON.stringify({
                            search: event.invoice_id ? String(event.invoice_id) : '',
                            source: 'admin_v2_payment_event'
                          }));
                          window.open('/app/orders', '_blank', 'noopener,noreferrer');
                        }}
                      >
                        Заказы
                      </button>
                      {event.payload?.tg_user_id ? (
                        <a
                          className="inline-action"
                          href={`/app/dossier?tg=${encodeURIComponent(event.payload.tg_user_id)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Досье
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
