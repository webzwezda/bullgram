import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, RefreshCcw, ShoppingCart } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

// «Мои покупки» (план 2026-09-26-userbot-product-split, Фаза 3): история покупок
// в магазине Bullgram — GET /api/shop/public/my-purchases (тот же парсинг строк,
// что в features/shop-storefront/useShopStorefront.js). Панелей оплаты здесь нет:
// чек оплачивается на PayPage/витрине сразу после заказа.

const STATUS_META = {
  pending: { label: 'Ждет оплату', className: 'bg-surface-subtle-strong text-ink-body border-border-default' },
  awaiting_receipt: { label: 'Ждет чек', className: 'bg-feedback-warning-bg text-feedback-warning-text border-feedback-warning-bg' },
  paid: { label: 'Оплата есть', className: 'bg-feedback-success-bg text-feedback-success-text border-feedback-success-bg' },
  expired: { label: 'Не оплачена вовремя', className: 'bg-surface-subtle text-ink-muted border-border-default' },
  cancelled: { label: 'Отменена', className: 'bg-feedback-error-bg text-feedback-error-text border-feedback-error-bg' }
};

function itemTypeLabel(item) {
  const type = item?.item_type;
  if (type === 'bundle') return 'Аккаунт + прокси';
  if (type === 'proxy') return 'Прокси';
  if (type === 'userbot') return 'Аккаунт';
  return 'Товар';
}

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    .format(new Date(value));
}

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

export default function PurchasesPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', purchases: [] });
  const [statusFilter, setStatusFilter] = useState('all');

  async function load() {
    if (!accessToken) return;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      setState({ loading: false, error: '', purchases: data.purchases || [] });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message || 'Не удалось загрузить покупки.' }));
    }
  }

  useEffect(() => {
    load();
  }, [accessToken]);

  const batchCounts = useMemo(() => {
    const map = new Map();
    for (const purchase of state.purchases) {
      const token = String(purchase.payload?.batch_token || '').trim();
      if (token) map.set(token, (map.get(token) || 0) + 1);
    }
    return map;
  }, [state.purchases]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return state.purchases;
    return state.purchases.filter((purchase) => purchase.status === statusFilter);
  }, [state.purchases, statusFilter]);

  const filterOptions = [
    { id: 'all', label: 'Все' },
    { id: 'pending', label: 'Ждут оплату' },
    { id: 'awaiting_receipt', label: 'Ждут чек' },
    { id: 'paid', label: 'Оплачены' }
  ];

  if (state.loading) {
    return <LoadingState text="Тянем твои покупки..." />;
  }

  return (
    <section className="page page--flush">
      <div className="page__header">
        <h1>Мои покупки</h1>
        <p>
          Всё, что ты покупал в магазине Bullgram: аккаунты, прокси и пакеты.
          Оплата проходит на витрине сразу после заказа — здесь только история.
        </p>
      </div>

      {state.error ? <div className="error-card">{state.error}</div> : null}

      {!state.error && state.purchases.length === 0 ? (
        <div className="section">
          <div className="card">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-surface-subtle border border-border-default flex items-center justify-center shrink-0">
                <ShoppingCart className="w-6 h-6 text-ink-faint" />
              </div>
              <div className="min-w-0">
                <h2 className="card__title" style={{ marginBottom: 0 }}>Покупок пока нет</h2>
                <p className="card__body" style={{ marginTop: 6 }}>
                  Аккаунты и прокси покупаются на витрине в разделе «Юзерботы».
                </p>
                <Link to="/userbots" className="link-action" style={{ marginTop: 10 }}>
                  Открыть витрину →
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!state.error && state.purchases.length > 0 ? (
        <div className="section">
          <div className="card">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-wrap gap-2">
                {filterOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`filter-chip${statusFilter === option.id ? ' filter-chip--active' : ''}`}
                    onClick={() => setStatusFilter(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={load}
                disabled={state.loading}
              >
                <RefreshCcw className={`w-3.5 h-3.5${state.loading ? ' animate-spin' : ''}`} />
                Обновить
              </button>
            </div>

            <div className="overflow-x-auto" style={{ marginTop: 12 }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Товар</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Сумма</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Статус</th>
                    <th className="py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Время</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length ? filtered.map((purchase) => {
                    const meta = STATUS_META[purchase.status] || STATUS_META.pending;
                    const batchToken = String(purchase.payload?.batch_token || '').trim();
                    const batchSize = batchToken ? (batchCounts.get(batchToken) || 1) : 0;
                    const transferPending = purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed';
                    return (
                      <tr key={purchase.id} className="border-b border-border-default hover:bg-surface-subtle/50">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2.5">
                            <Package className="w-4 h-4 text-ink-faint shrink-0" />
                            <div className="min-w-0">
                              <div className="font-bold text-ink-strong truncate">
                                {purchase.item?.title || 'Товар'}
                              </div>
                              <div className="text-xs text-ink-muted">
                                {itemTypeLabel(purchase.item)}
                                {batchSize > 1 ? ` • часть пакета из ${batchSize}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap font-bold text-ink-strong">
                          {formatTon(purchase.amount_ton)} TON
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${meta.className}`}>
                            {meta.label}
                          </span>
                          {transferPending ? (
                            <div className="text-xs text-feedback-warning-text mt-1">Передаем актив — пару минут</div>
                          ) : null}
                        </td>
                        <td className="py-3 whitespace-nowrap text-xs text-ink-body">
                          {formatWhen(purchase.created_at)}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-sm text-ink-muted">
                        Покупок с этим статусом нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
