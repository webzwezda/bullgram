import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

const ITEM_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'text_offer', label: 'Офферы' },
  { id: 'proxy', label: 'Прокси' },
  { id: 'bundle', label: 'Комплекты' },
  { id: 'customer_base_asset', label: 'Базы' }
];

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function itemPriceSummary(item) {
  const methods = item?.payment_methods?.length ? item.payment_methods : ['ton', 'p2p'];
  const parts = [];
  if (methods.includes('ton') && Number(item?.price_ton || 0) > 0) {
    parts.push(`${formatTon(item.price_ton)} TON`);
  }
  if (methods.includes('p2p') && Number(item?.price_rub || 0) > 0) {
    parts.push(`${formatRub(item.price_rub)} RUB`);
  }
  if (methods.includes('robokassa') && Number(item?.price_rub || 0) > 0) {
    parts.push(`${formatRub(item.price_rub)} RUB`);
  }
  return parts.join(' / ') || `${formatTon(item?.price_ton || 0)} TON`;
}

function itemTypeBadge(item) {
  const t = item?.item_type;
  if (t === 'text_offer') return 'Оффер';
  if (t === 'proxy') return 'Прокси';
  if (t === 'bundle') return 'Комплект';
  if (t === 'userbot') return 'Юзербот';
  if (t === 'customer_base_asset') return 'База';
  return t;
}

export function ShopPage() {
  const { user, accessToken } = useAuth();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState('');

  const highlightId = searchParams.get('item');

  useEffect(() => {
    async function load() {
      try {
        const data = await apiRequest('/api/shop/public/items');
        setItems(data.items || []);
        setError('');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    let result = items.filter((item) => item.status === 'published' && item.visibility !== 'private');
    if (filter !== 'all') {
      result = result.filter((item) => item.item_type === filter);
    }
    return result;
  }, [filter, items]);

  async function handleBuy(item, paymentMethod) {
    if (!user) {
      window.location.href = '/?login=1';
      return;
    }
    setBusyId(item.id);
    try {
      const body = {
        item_id: item.id,
        payment_method: paymentMethod
      };
      const data = await apiRequest('/api/shop/public/purchase', {
        accessToken,
        method: 'POST',
        body
      });
      if (paymentMethod === 'robokassa' && data.payload?.robokassa_url) {
        window.location.href = data.payload.robokassa_url;
        return;
      }
      window.location.href = '/purchases';
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-slate-400">Загружаем товары...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Магазин</h1>
        <p className="text-sm text-slate-500 mt-1">Цифровые товары для Telegram: офферы, прокси, комплекты и базы.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}

      {!user && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
          <a href="/?login=1" className="font-semibold hover:underline">Войдите</a>, чтобы покупать товары.
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {ITEM_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500">Товаров пока нет.</p>
          <a className="inline-block mt-4 text-sm text-indigo-600 hover:underline" href="/pricing">Посмотреть тарифы</a>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const methods = item?.payment_methods?.length ? item.payment_methods : ['ton'];
            const hasP2p = methods.includes('p2p');
            const hasTon = methods.includes('ton');
            const hasRobokassa = methods.includes('robokassa');
            const isHighlighted = highlightId && String(item.id) === String(highlightId);

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border p-5 space-y-3 transition-shadow ${
                  isHighlighted ? 'border-indigo-400 ring-2 ring-indigo-100 shadow-lg' : 'border-slate-200 hover:shadow-md'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-500">
                      {itemTypeBadge(item)}
                    </span>
                  </div>
                  <h3 className="font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                    {item.preview_text || item.description || 'Описание не задано'}
                  </p>
                </div>

                <div className="text-lg font-bold text-slate-900">{itemPriceSummary(item)}</div>

                <div className="flex gap-2 flex-wrap">
                  {hasTon && (
                    <button
                      className="site-button site-button--primary text-xs"
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleBuy(item, 'ton')}
                    >
                      {busyId === item.id ? '...' : 'Купить TON'}
                    </button>
                  )}
                  {hasP2p && (
                    <button
                      className="site-button text-xs"
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleBuy(item, 'p2p')}
                    >
                      {busyId === item.id ? '...' : 'Купить СБП'}
                    </button>
                  )}
                  {hasRobokassa && (
                    <button
                      className="site-button text-xs"
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleBuy(item, 'robokassa')}
                    >
                      {busyId === item.id ? '...' : 'Оплатить картой'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {user && (
        <div className="text-center pt-4">
          <a className="text-sm text-indigo-600 hover:underline" href="/purchases">Мои покупки</a>
        </div>
      )}
    </div>
  );
}
