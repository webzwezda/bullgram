import { Rocket, CircleCheckBig, CircleAlert } from 'lucide-react';

function statusBadge(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'online') return { text: 'online', cls: 'bg-emerald-50 text-emerald-700' };
  if (normalized === 'pending_activation') return { text: 'ожидает активации', cls: 'bg-amber-50 text-amber-700' };
  if (normalized === 'offline' || normalized === 'restricted' || normalized === 'session_revoked') return { text: normalized, cls: 'bg-rose-50 text-rose-700' };
  return { text: normalized || 'неизвестно', cls: 'bg-slate-100 text-slate-600' };
}

/* Секция «Помощник-юзербот» retention-страницы: карточки юзерботов-помощников
   со статусами и статистикой доставок. Чистый рендер — данные приходят пропсами. */
export function RetentionHelpersSection({ helperBots, helperStatsById }) {
  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Помощник-юзербот
            </h3>
          </div>

          {helperBots.length === 0 ? (
            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100 text-sm text-amber-800">
              <div className="font-bold mb-1">Не привязан</div>
              <div className="text-xs text-amber-700">
                Если бот заблокирован у подписчика, напоминание уйдёт в сбой. Привяжите userbot в настройках sales-бота.
                Учтите: ЛС дойдёт, только если у юзербота есть общий чат с этим человеком (например, ваша админ-группа
                воронки) — админ-права юзербота в этой группе повышают шансы доставки.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {helperBots.map((helper) => {
                const status = statusBadge(helper.runtime_status);
                const label = helper.custom_label || (helper.tg_username ? `@${helper.tg_username}` : 'Без имени');
                const hs = helperStatsById.get(helper.id) || { delivered: 0, failed: 0 };
                return (
                  <div
                    key={helper.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50/50 border border-slate-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                        <Rocket className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 truncate">{label}</div>
                        {helper.tg_username && helper.custom_label ? (
                          <div className="text-xs text-slate-500 font-mono truncate">@{helper.tg_username}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${status.cls}`}>
                        {status.text}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700">
                        <CircleCheckBig className="w-3 h-3" />
                        {hs.delivered} доставлено
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold ${hs.failed > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                        <CircleAlert className="w-3 h-3" />
                        {hs.failed} сбой
                      </span>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-slate-500 leading-relaxed">
                ЛС дойдёт, только если у юзербота есть общий чат с этим человеком (например, админ-группа воронки) — админ-права юзербота в этой группе повышают шансы доставки.
              </p>
            </div>
          )}
    </section>
  );
}
