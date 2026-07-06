import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Globe, Smartphone, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { formatWhen } from '../../pages/payment-settings/payment-settings.utils.js';

function pickIcon(itemType) {
  if (itemType === 'userbot') return Smartphone;
  if (itemType === 'proxy') return Globe;
  return ShoppingBag;
}

function statusBadge(status) {
  const lower = String(status || '').toLowerCase();
  if (lower === 'paid' || lower === 'completed' || lower === 'transferred') {
    return { label: 'Оплачено', class: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 };
  }
  if (lower === 'pending' || lower === 'processing') {
    return { label: 'В обработке', class: 'bg-amber-100 text-amber-700', Icon: Clock };
  }
  return { label: status || '—', class: 'bg-slate-100 text-slate-600', Icon: Clock };
}

export function ProfilePurchasesCard() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      const items = Array.isArray(data) ? data : (data?.items || data?.purchases || []);
      setState({ loading: false, items, error: '' });
    } catch (err) {
      setState({ loading: false, items: [], error: err?.message || 'Не удалось загрузить покупки' });
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Покупки</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Прокси, юзерботы и другие пакеты из магазина.
        </p>
      </div>

      {state.loading ? (
        <p className="text-sm text-slate-500">Загружаем покупки…</p>
      ) : state.error ? (
        <p className="text-sm text-rose-600">{state.error}</p>
      ) : state.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
          <ShoppingBag className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-700">Покупок пока нет</p>
          <p className="text-xs text-slate-500 mt-1">Загляните в магазин — там есть прокси и юзерботы.</p>
          <a
            href="/app/shop"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all"
          >
            Открыть магазин
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {state.items.map((entry) => {
            const item = entry?.item || entry?.shop_item || {};
            const itemType = entry?.item_type || item?.item_type || '';
            const Icon = pickIcon(itemType);
            const amountTon = entry?.amount_ton ?? item?.amount_ton ?? null;
            const status = statusBadge(entry?.status || entry?.ownership_transfer_status);
            const title = item?.title || entry?.title || 'Покупка';
            const subtitle = itemType ? {
              proxy: 'Прокси',
              userbot: 'Юзербот',
              resource: 'Ресурс'
            }[itemType] || itemType : '';

            return (
              <div
                key={entry?.id || `${title}-${entry?.created_at}`}
                className="flex items-center gap-4 p-3.5 rounded-2xl border border-slate-100 bg-white hover:border-slate-200 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-slate-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {subtitle ? <span className="mr-2">{subtitle}</span> : null}
                    {entry?.created_at ? formatWhen(entry.created_at) : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {amountTon ? (
                    <span className="text-sm font-bold text-slate-900">{amountTon} TON</span>
                  ) : null}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md ${status.class}`}>
                    <status.Icon className="w-3 h-3" />
                    {status.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
