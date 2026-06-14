import { useMemo } from 'react';
import { Coins } from 'lucide-react';
import { Badge } from '../../components/ui/badge.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function statusBadge(status) {
  const map = {
    awaiting_receipt: { label: 'Ждет проверки', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    paid: { label: 'Подтверждено', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    pending: { label: 'Ждет оплату', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
    expired: { label: 'Истекло', cls: 'bg-slate-100 text-slate-400 border-slate-200' }
  };
  const entry = map[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <Badge variant="outline" className={entry.cls}>{entry.label}</Badge>;
}

export function CryptoPurchasesSection({ paymentEvents = [], invoiceMap = new Map(), tariffs = [], plain = false }) {
  const tonEvents = useMemo(() => {
    return paymentEvents
      .filter((ev) => {
        // Only show final resolved actions in crypto log (approved, confirmed, rejected, expired),
        // filtering out intermediate draft creation events.
        const isResolvedEventType = ['payment_confirmed', 'admin_approved', 'admin_rejected', 'expired'].includes(ev.event_type);
        if (!isResolvedEventType) return false;

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
      .slice(0, 20);
  }, [paymentEvents, invoiceMap, tariffs]);

  const totalTon = useMemo(
    () => tonEvents.reduce((s, ev) => s + Number(ev.tonAmount), 0),
    [tonEvents]
  );

  return (
    <div className={plain ? "space-y-5" : "bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5"}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0">
          <Coins className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-slate-900">Оплаты за крипту</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            TON-оплаты за подписки.
          </p>
        </div>
        {tonEvents.length > 0 ? (
          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 shrink-0">
            {totalTon.toFixed(2)} TON
          </Badge>
        ) : null}
      </div>

      {!tonEvents.length ? (
        <p className="text-sm text-slate-500 py-2">Пока нет TON-оплат за подписки.</p>
      ) : (
        <div className="space-y-2">
          {tonEvents.map((ev) => (
            <div key={ev.id} className="flex items-center gap-3 text-sm py-2 border-b border-slate-100 last:border-0">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-900 truncate block">{ev.tariffTitle}</span>
                <span className="text-xs text-slate-400">{formatWhen(ev.created_at)}{ev.channelTitle ? ` · ${ev.channelTitle}` : ''}</span>
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
