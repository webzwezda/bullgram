import { useMemo } from 'react';
import { CheckCircle2, FileText, XCircle, ExternalLink, MessageSquare } from 'lucide-react';
import { Badge } from '../../components/ui/badge.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function statusBadge(status) {
  const map = {
    awaiting_receipt: { label: 'Ждет проверки', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    wait_admin: { label: 'Ждет админа', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    paid: { label: 'Подтверждено', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    rejected: { label: 'Отклонено', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
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

function enrichEvent(ev, invoiceMap, tariffs, membersMap) {
  const inv = invoiceMap.get(ev.invoice_id);
  const tariffId = inv?.tariff_id || ev.payload?.tariff_id;
  const tariff = tariffs.find((t) => t.id === tariffId);
  const tgUserId = inv?.tg_user_id || ev.payload?.tg_user_id || ev.tg_user_id;
  const customer = tgUserId ? membersMap.get(String(tgUserId)) : null;

  return {
    ...ev,
    invoice: inv,
    tariff,
    tariffTitle: tariff?.title || 'Тариф',
    channelTitle: tariff?.channels?.title || null,
    amountDisplay: formatAmount(ev, inv),
    tgUserDisplay: tgUserId ? String(tgUserId) : null,
    customer
  };
}

export function ReceiptVerificationSection({
  paymentEvents = [],
  invoiceMap = new Map(),
  tariffs = [],
  members = [],
  plain = false,
  onConfirm,
  onReject
}) {
  const membersMap = useMemo(() => {
    const map = new Map();
    for (const m of members) {
      if (m.tg_user_id) map.set(String(m.tg_user_id), m);
    }
    return map;
  }, [members]);

  const enriched = useMemo(
    () => paymentEvents.map((ev) => enrichEvent(ev, invoiceMap, tariffs, membersMap)),
    [paymentEvents, invoiceMap, tariffs, membersMap]
  );

  const awaiting = useMemo(() => {
    const latestByInvoice = new Map();
    for (const ev of enriched) {
      const isAwaitingEvent = ['awaiting_receipt', 'wait_admin'].includes(ev.status) || 
                              ['receipt_requested', 'receipt_uploaded'].includes(ev.event_type);
      if (!isAwaitingEvent) continue;

      const invStatus = ev.invoice?.status;
      const isInvoiceAwaiting = !invStatus || invStatus === 'awaiting_receipt' || invStatus === 'wait_admin' || invStatus === 'pending';
      if (!isInvoiceAwaiting) continue;

      const key = ev.invoice_id || ev.id;
      const existing = latestByInvoice.get(key);
      if (!existing || new Date(ev.created_at) > new Date(existing.created_at)) {
        latestByInvoice.set(key, ev);
      }
    }
    return Array.from(latestByInvoice.values());
  }, [enriched]);

  const recent = useMemo(
    () => enriched.filter((ev) => {
      // Only display final actions in the verification history (approved, rejected, expired),
      // filtering out intermediate draft and request steps of the checkout process.
      return ['payment_confirmed', 'admin_approved', 'admin_rejected', 'expired'].includes(ev.event_type);
    }),
    [enriched]
  );

  const USERBOT_CENTER_HANDOFF_KEY = 'bullrun_userbot_center_handoff';

  function handleWriteHandoff(tgUserId) {
    if (!tgUserId) return;
    const params = new URLSearchParams();
    params.set('tg_user_id', String(tgUserId));

    window.localStorage.setItem(USERBOT_CENTER_HANDOFF_KEY, JSON.stringify({
      tg_user_id: String(tgUserId),
      draft_message: 'Привет. Вижу счет на проверке. Подскажи, оплата прошла успешно? Если прикрепишь чек или напишешь подробности, я быстро подтвержу.'
    }));
    window.location.href = `/app/userbot-center?tg_user_id=${encodeURIComponent(tgUserId)}`;
  }

  function handleViewCustomer(tgUserId) {
    if (!tgUserId) return;
    window.localStorage.setItem('orders_search_preset', JSON.stringify({
      search: String(tgUserId),
      source: 'receipt_verification'
    }));
    window.open('/app/customers?tab=bot', '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={plain ? "space-y-5" : "bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5"}>
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
            <div key={ev.id} className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 hover:border-amber-300 transition-all shadow-sm">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="font-bold text-slate-900 text-base">{ev.tariffTitle}</div>
                  <div className="text-xs text-slate-600 font-medium">
                    {ev.channelTitle ? `${ev.channelTitle} · ` : ''}
                    <span className="text-slate-900 font-black">{ev.amountDisplay}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Отмечена: {formatWhen(ev.created_at)}
                  </div>
                  
                  {/* Subscriber Information */}
                  <div className="pt-1 text-xs text-slate-600 flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-400">Создатель:</span>
                    {ev.customer ? (
                      <>
                        <span className="text-slate-800 font-bold">
                          {ev.customer.display_name || ev.customer.first_name || `TG ${ev.tgUserDisplay}`}
                        </span>
                        {ev.customer.username ? (
                          <a
                            href={`https://t.me/${ev.customer.username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 hover:text-indigo-700 hover:underline font-bold inline-flex items-center gap-0.5"
                          >
                            @{ev.customer.username} <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-700 font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                        ID: {ev.tgUserDisplay || 'неизвестен'}
                      </span>
                    )}
                  </div>
                </div>

                {ev.payload?.receipt_file_url ? (
                  <div className="shrink-0 self-start md:self-center">
                    <a
                      href={ev.payload.receipt_file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100/70 px-3 py-2 rounded-xl transition-all"
                    >
                      <FileText className="w-4 h-4" /> Посмотреть чек
                    </a>
                  </div>
                ) : (
                  <div className="shrink-0 self-start md:self-center text-xs text-slate-400 font-semibold italic">
                    Чек не приложен
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-amber-200/50">
                <button
                  type="button"
                  onClick={() => onConfirm?.(ev.invoice_id)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-md hover:shadow-emerald-600/10 cursor-pointer transition-all"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Подтвердить
                </button>
                <button
                  type="button"
                  onClick={() => onReject?.(ev.invoice_id)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 cursor-pointer transition-all"
                >
                  <XCircle className="h-3.5 w-3.5" /> Отклонить
                </button>

                {ev.tgUserDisplay && (
                  <div className="ml-0 md:ml-auto flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleWriteHandoff(ev.tgUserDisplay)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 cursor-pointer transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-slate-400" /> Написать
                    </button>
                    <a
                      href={`/app/dossier?tg=${encodeURIComponent(ev.tgUserDisplay)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 cursor-pointer transition-all"
                    >
                      Досье
                    </a>
                    <button
                      type="button"
                      onClick={() => handleViewCustomer(ev.tgUserDisplay)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 cursor-pointer transition-all"
                    >
                      Клиент
                    </button>
                  </div>
                )}
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
            {recent.slice(0, 10).map((ev) => {
              const customerInfo = ev.customer
                ? (ev.customer.username ? ` · @${ev.customer.username}` : ` · ${ev.customer.display_name || ev.customer.first_name}`)
                : (ev.tgUserDisplay ? ` · ID: ${ev.tgUserDisplay}` : '');
              return (
                <div key={ev.id} className="flex items-center gap-3 text-sm py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-slate-900 truncate block">{ev.tariffTitle}</span>
                    <span className="text-xs text-slate-400">{formatWhen(ev.created_at)} · {ev.amountDisplay}{customerInfo}</span>
                  </div>
                  {statusBadge(ev.status)}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
