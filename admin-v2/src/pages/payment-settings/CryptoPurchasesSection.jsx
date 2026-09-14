import { useMemo } from 'react';
import { Coins } from 'lucide-react';
import { Badge } from '../../components/ui/badge.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function statusBadge(status) {
  const map = {
    awaiting_receipt: { label: 'Ждёт проверки', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    wait_admin: { label: 'Ждёт админа', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    paid: { label: 'Подтверждено', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    pending: { label: 'Ждёт оплату', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
    rejected: { label: 'Отклонено', cls: 'bg-red-50 text-red-700 border-red-200' },
    expired: { label: 'Истекло', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  };
  const entry = map[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <Badge variant="outline" className={entry.cls}>{entry.label}</Badge>;
}

// Реальный словарь event_type из бэкенда: logPaymentEvent (official-bot) пишет
// ton_manual_confirmed / ton_manual_check / admin_approved / admin_rejected /
// receipt_uploaded / free_activated / invoice_created; webhook (payment.routes)
// — invoice_completed / webhook_received / webhook_test / rejected_secret.
// В журнале покупок — жизненный цикл оплаты; служебные и «бесплатные» типы не показываем.
const PURCHASE_EVENT_TYPES = new Set([
  'ton_manual_confirmed',
  'ton_manual_check',
  'admin_approved',
  'admin_rejected',
  'receipt_uploaded',
  'invoice_completed',
  'activation_failed'
]);

export function CryptoPurchasesSection({ paymentEvents = [], invoiceMap = new Map(), tariffs = [], plain = false }) {
  const tonEvents = useMemo(() => {
    return paymentEvents
      .filter((ev) => {
        // Только жизненный цикл покупки крипты — реальные event_type бэкенда,
        // не промежуточное создание счёта и служебные события.
        if (!PURCHASE_EVENT_TYPES.has(ev.event_type)) return false;

        const inv = invoiceMap.get(ev.invoice_id);
        const currency = inv?.currency || ev.payload?.currency;
        const provider = ev.provider || '';
        return currency === 'TON' || provider === 'manual_ton';
      })
      .map((ev) => {
        const inv = invoiceMap.get(ev.invoice_id);
        const tariffId = inv?.tariff_id || ev.payload?.tariff_id;
        const tariff = tariffs.find((t) => t.id === tariffId);
        const amount = inv?.amount || ev.payload?.amount || 0;
        return {
          ...ev,
          tariffTitle: tariff?.title || 'Тариф',
          channelTitle: tariff?.channels?.title || null,
          tonAmount: Number(amount).toFixed(2)
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      // Ручной TON-чек пишет два paid-события на инвойс (ton_manual_check + ton_manual_confirmed);
      // журнал и бейдж показывают одну строку на оплату — свежайшее событие по инвойсу
      // (массив уже отсортирован свежие-сверху, dedupe хранит первое вхождение).
      .reduce((deduped, ev) => {
        const key = ev.invoice_id || ev.id;
        if (!deduped.some((seen) => (seen.invoice_id || seen.id) === key)) deduped.push(ev);
        return deduped;
      }, [])
      .slice(0, 20);
  }, [paymentEvents, invoiceMap, tariffs]);

  // В бейдже показываем сумму только состоявшихся платежей из последних N событий журнала,
  // а не всех отображаемых строк (среди них есть rejected/pending).
  const paidTotal = useMemo(
    () => tonEvents
      .filter((ev) => ev.status === 'paid')
      .reduce((s, ev) => s + Number(ev.tonAmount), 0),
    [tonEvents]
  );

  return (
    <div className={plain ? "space-y-5" : "bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5"}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
          <Coins className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black tracking-tight text-slate-900">Оплаты за крипту</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Ручные TON-переводы и чеки по подпискам.
          </p>
        </div>
        {tonEvents.length > 0 ? (
          <div className="text-right shrink-0">
            <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
              {paidTotal.toFixed(2)} TON
            </Badge>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {tonEvents.length === 1 ? 'по последнему событию' : `по последним ${tonEvents.length} событиям`}
            </div>
          </div>
        ) : null}
      </div>

      {!tonEvents.length ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
          <Coins className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-700">TON-оплат пока нет</p>
          <p className="text-xs text-slate-500 mt-1">
            Здесь появятся переводы и чеки после первых оплат подписок.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tonEvents.map((ev) => (
            <div key={ev.id} className="flex items-center gap-3 text-sm py-2 border-b border-slate-100 last:border-0">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-900 truncate block">{ev.tariffTitle}</span>
                <span className="text-xs text-slate-500">{formatWhen(ev.created_at)}{ev.channelTitle ? ` · ${ev.channelTitle}` : ''}</span>
              </div>
              <span className="font-medium text-slate-900 shrink-0">{ev.tonAmount} TON</span>
              {statusBadge(ev.status)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
