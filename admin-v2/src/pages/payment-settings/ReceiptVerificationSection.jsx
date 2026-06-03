import { useMemo } from 'react';
import { CheckCircle2, FileText, XCircle } from 'lucide-react';
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

function formatAmount(ev, inv) {
  const currency = inv?.currency || ev.payload?.currency || 'RUB';
  const amount = inv?.amount || ev.payload?.amount || ev.payload?.original_amount || 0;
  if (currency === 'TON') return `${Number(amount).toFixed(2)} TON`;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(amount))} ₽`;
}

function enrichEvent(ev, invoiceMap, tariffs) {
  const inv = invoiceMap.get(ev.invoice_id);
  const tariffId = inv?.tariff_id || ev.payload?.tariff_id;
  const tariff = tariffs.find((t) => t.id === tariffId);
  return {
    ...ev,
    invoice: inv,
    tariff,
    tariffTitle: tariff?.title || 'Тариф',
    channelTitle: tariff?.channels?.title || null,
    amountDisplay: formatAmount(ev, inv),
    tgUserDisplay: inv?.tg_user_id ? `${inv.tg_user_id}` : null
  };
}

export function ReceiptVerificationSection({ paymentEvents = [], invoiceMap = new Map(), tariffs = [] }) {
  const enriched = useMemo(
    () => paymentEvents.map((ev) => enrichEvent(ev, invoiceMap, tariffs)),
    [paymentEvents, invoiceMap, tariffs]
  );

  const awaiting = useMemo(
    () => enriched.filter((ev) => ev.status === 'awaiting_receipt' || ev.event_type === 'receipt_requested'),
    [enriched]
  );

  const recent = useMemo(
    () => enriched.filter((ev) => ['paid', 'expired'].includes(ev.status) || ev.event_type === 'payment_confirmed'),
    [enriched]
  );

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 shrink-0">
          <FileText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-slate-900">Проверка чеков</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Подписчик нажал «Я оплатил» — проверь чек и подтверди.
          </p>
        </div>
        {awaiting.length > 0 ? (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 shrink-0">
            {awaiting.length} {awaiting.length === 1 ? 'ждёт' : 'ждут'}
          </Badge>
        ) : null}
      </div>

      {!awaiting.length ? (
        <p className="text-sm text-slate-500 py-2">Нет оплат, которые нужно проверить.</p>
      ) : (
        <div className="space-y-3">
          {awaiting.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{ev.tariffTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {ev.channelTitle ? `${ev.channelTitle} · ` : ''}{ev.amountDisplay}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Отмечена: {formatWhen(ev.created_at)}
                  </div>
                </div>
              </div>
              {ev.payload?.receipt_file_url ? (
                <div className="mt-2 text-xs">
                  <a href={ev.payload.receipt_file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Открыть чек</a>
                </div>
              ) : null}
              <div className="flex gap-2 mt-3">
                <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Подтвердить
                </button>
                <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">
                  <XCircle className="h-3.5 w-3.5" /> Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold text-slate-500 hover:text-slate-700 select-none">
            Последние проверки ({recent.length})
          </summary>
          <div className="mt-3 space-y-2">
            {recent.slice(0, 10).map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 text-sm py-2 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-slate-900 truncate block">{ev.tariffTitle}</span>
                  <span className="text-xs text-slate-400">{formatWhen(ev.created_at)} · {ev.amountDisplay}</span>
                </div>
                {statusBadge(ev.status)}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
