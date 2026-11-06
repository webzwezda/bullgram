import { memo, useMemo } from 'react';
import { RefreshCw, Send, Megaphone, MoreHorizontal, Users } from 'lucide-react';
import { TABS, plural, ROW_MENU_STYLE, closeAllRowMenus, openUserbotCenterHandoff } from '../utils/customersRows.js';

const AudienceTable = memo(function AudienceTable({ target, syncingType, onSync, crmMap, onAction, mutatingRowId }) {
  // Хуки стоят ДО раннего return по !target — порядок хуков не зависит от пропсов.
  const members = target?.members || [];
  const isPaid = !!target && (target.targetType === 'paid_channel' || target.targetType === 'paid_chat');

  // Обогащение до 5000 участников считаем только при смене members/crmMap, а не
  // на каждый рендер родителя (поиск, поллинг раз в минуту, флипы row-action).
  // Счётчики «оплачено/просрочено/без оплаты» живут здесь же — вместе с rows.
  const { enrichedRows, paidCount, freeCount, expiredCount } = useMemo(() => {
    let paid = 0;
    let free = 0;
    let expired = 0;
    let rows = members;
    if (isPaid) {
      rows = members.map((m) => {
        const crm = crmMap.get(String(m.tg_user_id));
        let paymentStatus = 'free';
        if (crm?.status === 'active') { paymentStatus = 'paid'; paid++; }
        else if (crm?.status === 'expired') { paymentStatus = 'expired'; expired++; }
        else { free++; }
        return { ...m, crm, paymentStatus };
      });
    }
    return { enrichedRows: rows, paidCount: paid, freeCount: free, expiredCount: expired };
  }, [members, crmMap, isPaid]);

  if (!target) {
    return (
      <div className="p-16 text-center flex flex-col items-center">
        <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
          <Users className="w-8 h-8" />
        </div>
        <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">Группа не подключена</h4>
        <p className="text-ink-muted font-medium text-sm">Добавьте эту группу в контуре продаж на экране «Бот продаж»</p>
      </div>
    );
  }

  const targetType = target.targetType;
  const channelId = target.channelId;

  return (
    <div className="overflow-hidden flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-8 py-6 border-b border-slate-100 bg-surface-subtle/30 gap-3">
        <div>
          <h3 className="text-xl font-black text-ink-strong">{target.channelTitle || TABS.find(t => t.id === `audience-${targetType}`)?.label || 'Группа'}</h3>
          <div className="text-sm text-ink-muted mt-0.5 flex flex-wrap gap-x-3">
            <span>{target.totalMembers} {plural(target.totalMembers, 'участник', 'участника', 'участников')}</span>
            {isPaid && paidCount > 0 && <span className="text-emerald-600">{paidCount} оплачено</span>}
            {isPaid && expiredCount > 0 && <span className="text-amber-600">{expiredCount} просрочено</span>}
            {isPaid && freeCount > 0 && <span className="text-red-500">{freeCount} без оплаты</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSync(targetType)}
            disabled={!!syncingType}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-border-default rounded-xl text-sm font-bold text-ink-body shadow-sm hover:bg-surface-subtle transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncingType === targetType ? 'animate-spin' : ''}`} />
            {syncingType === targetType ? 'Загружаем...' : 'Обновить список'}
          </button>
          {target.baseId && (
            <a
              href={`/app/broadcast?baseId=${target.baseId}`}
              className="flex items-center gap-2 px-4 py-2.5 bg-action-primary !text-action-primary-text rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-action-primary-hover transition-all"
            >
              <Megaphone className="w-4 h-4" />
              Рассылка
            </a>
          )}
        </div>
      </div>

      {!target.baseId ? (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Users className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">Участники еще не загружены</h4>
          <p className="text-ink-muted font-medium text-sm">Нажмите «Обновить список» чтобы загрузить участников из Telegram</p>
        </div>
      ) : members.length === 0 ? (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Users className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">Пусто</h4>
          <p className="text-ink-muted font-medium text-sm">В этой группе пока нет участников</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-surface-subtle/80 border-b border-slate-100">
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Имя</th>
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden md:table-cell">Username</th>
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden lg:table-cell">TG ID</th>
                {!isPaid && <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Приватка</th>}
                {isPaid && (
                  <>
                    <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Оплата</th>
                    <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Доступ до</th>
                  </>
                )}
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {enrichedRows.slice(0, 100).map((row) => {
                const rowId = row.tg_user_id;
                const actionRow = {
                  tg_user_id: String(row.tg_user_id),
                  tg_username: row.username,
                  display_name: row.display_name,
                  first_name: row.first_name,
                  last_name: row.last_name,
                  channel_id: channelId,
                  channel_title: target.channelTitle,
                  id: row.crm?.id || null,
                  _crmSubscription: !!row.crm?.id
                };
                const nameCell = (
                  <td className="px-6 py-4">
                    <div className="font-black text-ink-strong text-sm truncate">
                      {row.display_name || row.first_name || (row.username ? `@${row.username}` : 'Неизвестный')}
                    </div>
                  </td>
                );
                const usernameCell = (
                  <td className="px-6 py-4 hidden md:table-cell">
                    {row.username ? <span className="text-xs font-semibold text-ink-muted">@{row.username}</span> : <span className="text-slate-300">—</span>}
                  </td>
                );
                const idCell = (
                  <td className="px-6 py-4 hidden lg:table-cell">
                    {row.tg_user_id
                      ? <span className="font-mono text-xs text-ink-muted">{row.tg_user_id}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                );
                // Для открытых групп: есть ли этот человек в платной приватке
                const crmRow = crmMap.get(String(row.tg_user_id));
                const privateCell = (
                  <td className="px-6 py-4">
                    {crmRow?.status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-feedback-success-bg text-emerald-600 ring-1 ring-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Активна
                      </span>
                    ) : crmRow?.status === 'expired' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-feedback-warning-bg text-amber-600 ring-1 ring-amber-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Истекла
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>
                );
                if (isPaid) {
                  const ps = row.paymentStatus;
                  const statusStyles = ps === 'paid'
                    ? 'bg-feedback-success-bg text-emerald-600 ring-1 ring-emerald-200'
                    : ps === 'expired'
                      ? 'bg-feedback-warning-bg text-amber-600 ring-1 ring-amber-200'
                      : 'bg-feedback-error-bg text-red-600 ring-1 ring-red-200';
                  const statusLabel = ps === 'paid' ? 'Оплачено' : ps === 'expired' ? 'Просрочен' : 'Без оплаты';
                  const dot = ps === 'paid' ? 'bg-emerald-500' : ps === 'expired' ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <tr key={rowId} className="hover:bg-surface-subtle/50 transition-colors">
                      {nameCell}
                      {usernameCell}
                      {idCell}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg ${statusStyles}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-medium">
                        {row.crm?.expires_at
                          ? new Date(row.crm.expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                          : row.paymentStatus === 'paid' ? 'Навсегда' : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="p-2 bg-white border border-border-default text-ink-muted hover:text-ink-strong hover:border-border-strong hover:bg-surface-subtle rounded-lg transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                            popovertarget={`row-menu-aud-${targetType}-${rowId}`}
                            disabled={!!mutatingRowId}
                            title="Действия"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <div
                            id={`row-menu-aud-${targetType}-${rowId}`}
                            popover="auto"
                            className="w-56 rounded-2xl border border-border-default bg-white shadow-xl shadow-slate-900/10 overflow-hidden p-0"
                            style={ROW_MENU_STYLE}
                          >
                            <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'extend-5'); }}>Продлить на 5 дней</button>
                            <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'extend-30'); }}>Продлить на 30 дней</button>
                            <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'extend-forever'); }}>Выдать навсегда</button>
                            <div className="border-t border-slate-100" />
                            {actionRow._crmSubscription && (
                              <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'kick'); }}>Удалить из группы</button>
                            )}
                          </div>
                          {row.tg_user_id && (
                            <>
                              <button className="p-2 bg-white border border-border-default text-ink-faint hover:text-action-primary hover:border-indigo-200 hover:bg-indigo-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(String(row.tg_user_id), '', target.tgChatId || '')} title="Написать через юзербота" aria-label="Написать через юзербота">
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={rowId} className="hover:bg-surface-subtle/50 transition-colors">
                    {nameCell}
                    {usernameCell}
                    {idCell}
                    {privateCell}
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {row.tg_user_id && (
                          <>
                            <button className="p-2 bg-white border border-border-default text-ink-faint hover:text-action-primary hover:border-indigo-200 hover:bg-indigo-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(String(row.tg_user_id), '', target.tgChatId || '')} title="Написать через юзербота" aria-label="Написать через юзербота">
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {enrichedRows.length > 100 && (
            <div className="px-6 py-3 text-sm text-ink-muted font-medium border-t border-slate-100 bg-surface-subtle/50">
              Показано 100 из {enrichedRows.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export { AudienceTable };
