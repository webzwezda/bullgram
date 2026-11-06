import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { formatRelativeTime } from './AbandonedHistorySection.jsx';

function InvoiceRow({ inv, channelTitle, onPush }) {
  const originalPrice = Number(inv.tariffs?.price || 0);
  const hasDiscount = originalPrice > 0 && Number(inv.amount) < originalPrice;
  const discountPercent = hasDiscount ? Math.round(((originalPrice - inv.amount) / originalPrice) * 100) : 0;
  const isTrial = !!inv.tariffs?.is_trial;
  const tariffTitle = inv.tariffs?.trial_label || inv.tariffs?.title || 'Неизвестно';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-100">
      <div className="flex items-center gap-3 min-w-0">
        <ShoppingCart className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate font-mono">
            {inv.tg_user_id}
          </div>
          <div className="text-xs text-slate-500 font-medium truncate">
            {channelTitle} · {tariffTitle}{isTrial ? ' · пробник' : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <div className="text-sm font-bold text-slate-900">
            {inv.amount} {inv.currency}
          </div>
          {hasDiscount ? (
            <div className="text-[11px] text-emerald-600 font-bold">
              −{discountPercent}% (было {originalPrice} {inv.currency})
            </div>
          ) : null}
          <div className="text-[11px] text-slate-400 font-medium">
            {formatRelativeTime(inv.created_at)}
          </div>
        </div>
        <button
          type="button"
          className="px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          onClick={onPush}
        >
          В рассылку
        </button>
      </div>
    </div>
  );
}

/* Секция «В окне автоматического дожима»: инвойсы 2-3ч без напоминания. */
export function AbandonedInWindowSection({ queueLabel, inWindow, channelTitleById, pushToBroadcast }) {
  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              В окне автоматического дожима
            </h3>
            <span className="text-xs font-bold text-slate-400">{queueLabel}</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-2xl">
            Счета возрастом 2-3 часа без напоминания. Получат сообщение автоматически, раз в 15 минут.
          </p>

          {inWindow.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Сейчас никто не попадает в окно автоматического дожима.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {inWindow.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  channelTitle={channelTitleById.get(inv.channel_id) || 'Канал'}
                  onPush={() => pushToBroadcast([String(inv.tg_user_id)], `В окне · ${inv.tg_user_id}`)}
                />
              ))}
            </div>
          )}
    </section>
  );
}

/* Секция «Требуют ручного разбора»: инвойсы старше 3ч + передача списка в рассылку. */
export function AbandonedStaleSection({ staleLabel, stale, staleTgIds, channelTitleById, pushToBroadcast }) {
  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Требуют ручного разбора
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400">{staleLabel}</span>
              {staleTgIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                    onClick={() => pushToBroadcast(staleTgIds, 'Вне окна дожима')}
                  >
                    Передать список в рассылку
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-2xl">
            Счета старше 3 часов. Автоматический дожим для них уже не сработает. Передайте подписчиков <Link to="/broadcast" className="font-bold !text-indigo-600 hover:!text-indigo-700 hover:!underline">в рассылку</Link>.
          </p>

          {stale.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Счетов вне окна дожима нет.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {stale.slice(0, 50).map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  channelTitle={channelTitleById.get(inv.channel_id) || 'Канал'}
                  onPush={() => pushToBroadcast([String(inv.tg_user_id)], `Вне окна · ${inv.tg_user_id}`)}
                />
              ))}
            </div>
          )}
    </section>
  );
}
