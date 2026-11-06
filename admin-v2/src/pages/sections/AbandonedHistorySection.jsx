import { Fragment } from 'react';
import { Send, AlertCircle, Ban, Inbox, ChevronRight } from 'lucide-react';

export function formatRelativeTime(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 24 * 3600_000) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const hoursTotal = Math.floor(diff / 3600_000);
  if (hoursTotal < 48) return `${hoursTotal} ч назад`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function deliveryBadge(deliveredBy = '', payload = {}) {
  switch (deliveredBy) {
    case 'bot':
      return { text: 'Бот', cls: 'bg-emerald-50 text-emerald-700', Icon: Send };
    case 'skipped': {
      const reason = payload?.reason;
      const text = reason === 'already_subscribed'
        ? 'Пропущено: активная подписка'
        : reason === 'newer_invoice_exists'
          ? 'Пропущено: создан новый счёт'
          : 'Пропущено';
      return { text, cls: 'bg-slate-100 text-slate-600', Icon: Ban };
    }
    case 'failed':
      return { text: 'Не доставлено', cls: 'bg-rose-50 text-rose-700', Icon: AlertCircle };
    default:
      return { text: 'Неизвестно', cls: 'bg-slate-100 text-slate-600', Icon: AlertCircle };
  }
}

/* Секция «История отправок» брошенных корзин: таблица access_events за ~7 дней
   с раскрытием текста сообщения. Чистый рендер — данные и экспандер приходят пропсами. */
export function AbandonedHistorySection({ events, channelTitleById, expandedEventId, setExpandedEventId, selectedBotLabel }) {
  return (
    <div>
          <div className="px-6 md:px-8 pt-6 pb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              История отправок
            </h3>
            <span className="text-xs font-bold text-slate-400">за последние ~7 дней</span>
          </div>

          {events.length === 0 ? (
            <div className="p-16 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
                <Inbox className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">История пуста</h4>
              <p className="text-slate-500 font-medium text-sm max-w-md">
                Отправленных напоминаний пока нет. Записи появятся здесь автоматически после первой отправки «Брошенные корзины» для бота {selectedBotLabel}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Время</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Подписчик</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Канал</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Сумма</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Доставлено</th>
                    <th className="px-6 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-500">Текст</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const payload = event.payload || {};
                    const badge = deliveryBadge(payload.delivered_by, payload);
                    const Icon = badge.Icon;
                    const isExpanded = expandedEventId === event.id;
                    const discount = Number(payload.discount_percent || 0);
                    const amountCell = discount > 0
                      ? `${payload.original_amount}→${payload.discounted_amount} ${payload.currency || ''} (-${discount}%)`
                      : `${payload.original_amount || '—'} ${payload.currency || ''}`;
                    return (
                      <Fragment key={event.id}>
                        <tr
                          className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/30 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50/50' : ''}`}
                          onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-xs font-medium text-slate-500">
                            {formatRelativeTime(event.created_at)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-bold text-slate-900 font-mono">
                              {event.tg_user_id}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-700">
                            {channelTitleById.get(event.channel_id) || '—'}
                          </td>
                          <td className="px-6 py-4 text-xs font-medium text-slate-600">
                            {amountCell}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
                              <Icon className="w-3 h-3" />
                              {badge.text}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedEventId(isExpanded ? null : event.id);
                              }}
                            >
                              {isExpanded ? 'Скрыть' : 'Показать'}
                              <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="bg-slate-50/30">
                            <td colSpan={6} className="px-6 pb-5 pt-1">
                              <div className="ml-2 p-4 bg-white border border-slate-200 rounded-xl">
                                <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                  Текст сообщения
                                </div>
                                <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed max-h-[400px] overflow-y-auto">
                                  {payload.message_text || '— нет текста —'}
                                </pre>
                                {payload.error ? (
                                  <div className="mt-3 text-xs text-rose-600 font-medium">
                                    Ошибка: {payload.error}
                                  </div>
                                ) : null}
                                {payload.reason ? (
                                  <div className="mt-3 text-xs text-slate-500 font-medium">
                                    Причина: {payload.reason}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
