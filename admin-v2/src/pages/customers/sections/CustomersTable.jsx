import { Send, ChevronRight, CheckCircle2, Clock, MoreHorizontal, FileText } from 'lucide-react';
import {
  TABS,
  BOT_SUBTABS,
  CAPS_KEY_BY_SUBTAB,
  plural,
  ROW_MENU_STYLE,
  canManageRow,
  getClientDisplayName,
  getContextDisplay,
  openUserbotCenterHandoff
} from '../utils/customersRows.js';

export function CustomersTable({
  state,
  isBotTab,
  activeBotSubtab,
  setBotSubtab,
  subtabCounts,
  activeTab,
  effectiveTab,
  activeRows,
  activeCaps,
  search,
  limit,
  setLimit,
  mutatingRowId,
  runSubscriptionAction
}) {
  return (
    <>
          {isBotTab && (
            <div className="relative mx-8 mt-4">
              <div className="flex gap-2 p-1.5 bg-surface-subtle-strong rounded-2xl overflow-x-auto">
                {BOT_SUBTABS.map((sub) => {
                  const count = subtabCounts[sub.id] || 0;
                  const subCap = state.caps ? (state.caps[CAPS_KEY_BY_SUBTAB[sub.id]] || null) : null;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      className={`shrink-0 px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 ${
                        activeBotSubtab === sub.id
                          ? 'bg-white text-action-primary shadow-sm'
                          : 'text-slate-600 hover:text-ink-body'
                      }`}
                      onClick={() => setBotSubtab(sub.id)}
                    >
                      {sub.label}
                      {count > 0 && (
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-md ${activeBotSubtab === sub.id ? 'bg-indigo-100 text-action-primary' : 'bg-white text-ink-muted'}`}
                          title={subCap?.truncated ? `Показаны последние ${subCap.limit} ${plural(subCap.limit, 'запись', 'записи', 'записей')}` : undefined}
                        >
                          {subCap?.truncated ? `${count}+` : count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-slate-100 via-slate-100/70 to-transparent" />
            </div>
          )}
        <div className="overflow-hidden flex flex-col">

          {/* Table Header Area */}
          <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 bg-surface-subtle/30">
            <h3 className="text-xl font-black text-ink-strong flex items-center gap-3">
              {isBotTab
                ? (BOT_SUBTABS.find((sub) => sub.id === activeBotSubtab)?.label || 'Клиенты')
                : (TABS.find((tab) => tab.id === activeTab)?.label || 'Клиенты')}
            </h3>
            <div className="flex items-center gap-3">
              <span className="px-4 py-1.5 bg-surface-subtle text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-100">
                {/* total из caps — размер всего среза таблицы, а вкладка показывает
                    подмножество (статусы, дедуп по контактам), поэтому честная
                    нижняя граница — «N+ показанных», не total */}
                {activeCaps?.truncated
                  ? `${activeRows.length}+ ${plural(activeRows.length, 'запись', 'записи', 'записей')} · показаны последние ${activeCaps.limit}`
                  : `${activeRows.length} ${plural(activeRows.length, 'запись', 'записи', 'записей')}`}
              </span>
            </div>
          </div>

          {activeRows.length === 0 ? (
            (() => {
              const searching = search.trim().length > 0;
              const subMeta = BOT_SUBTABS.find((s) => s.id === (effectiveTab || activeBotSubtab));
              const emptyMeta = searching || !subMeta?.empty
                ? { title: 'Ничего не найдено', text: 'Попробуйте изменить фильтры или поиск' }
                : subMeta.empty;
              return (
                <div className="p-16 text-center flex flex-col items-center">
                  <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">{emptyMeta.title}</h4>
                  <p className="text-ink-muted font-medium text-sm">{emptyMeta.text}</p>
                </div>
              );
            })()
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-subtle/80 border-b border-slate-100">
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Клиент</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden md:table-cell">Тариф / канал</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Статус</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden lg:table-cell">Причина</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {activeRows.slice(0, limit).map((row) => {
                      const statusConfig = (() => {
                        if (row.status === 'Доступ активен') return { bg: 'bg-feedback-success-bg', text: 'text-feedback-success-text', border: 'border-emerald-200', icon: CheckCircle2 };
                        if (row.status === 'Доступ закончился') return { bg: 'bg-feedback-error-bg', text: 'text-feedback-error-text', border: 'border-red-200', icon: Clock };
                        return { bg: 'bg-surface-subtle-strong', text: 'text-slate-600', border: 'border-border-default', icon: null };
                      })();
                      const contextDisplay = getContextDisplay(row);

                      const StatusIcon = statusConfig.icon;

                      return (
                        <tr key={`${activeTab}-${row.id}`} className="hover:bg-surface-subtle/80 transition-colors">

                          {/* Client Col */}
                          <td className="px-6 py-4">
                            <div className="min-w-0">
                                <div className="font-black text-ink-strong text-sm truncate flex items-center gap-1.5">
                                  <span>
                                    {getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : row.tg_user_id ? `ID: ${row.tg_user_id}` : 'Неизвестный')}
                                  </span>
                                </div>
                                {row.tg_user_id ? (
                                  <div className="text-[10px] font-bold text-ink-muted uppercase tracking-tight">
                                    ID: {row.tg_user_id}
                                  </div>
                                ) : null}
                                {row.tg_username ? (
                                  <div className="text-xs font-semibold text-ink-muted truncate">
                                    @{row.tg_username}
                                  </div>
                                ) : null}
                            </div>
                          </td>

                          {/* Context Col */}
                          <td className="px-6 py-4 hidden md:table-cell">
                            <div className="font-bold text-slate-800 text-sm truncate">
                              {contextDisplay.primary}
                            </div>
                            {contextDisplay.secondary ? (
                              <div className="text-xs text-ink-muted truncate mt-1">
                                {contextDisplay.secondary}
                              </div>
                            ) : null}
                          </td>

                          {/* Status Col */}
                          <td className="px-6 py-4">
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border shadow-sm ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                              {StatusIcon && <StatusIcon className="w-3 h-3" />}
                              {row.status || '—'}
                            </div>
                          </td>

                          {/* Reason Col */}
                          <td className="px-6 py-4 hidden lg:table-cell">
                            <div className="text-slate-600 font-medium text-sm line-clamp-2" title={row.reason || ''}>
                              {row.reason || '—'}
                            </div>
                          </td>

                          {/* Actions Col */}
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {canManageRow(row) ? (
                                <>
                                  <button
                                    type="button"
                                    className="p-2 bg-white border border-border-default text-ink-muted hover:text-ink-strong hover:border-border-strong hover:bg-surface-subtle rounded-lg transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                    popovertarget={`row-menu-${row.id}`}
                                    disabled={mutatingRowId === String(row.id)}
                                    title="Действия"
                                  >
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </button>

                                  <div
                                    id={`row-menu-${row.id}`}
                                    popover="auto"
                                    className="w-56 rounded-2xl border border-border-default bg-white shadow-xl shadow-slate-900/10 overflow-hidden p-0"
                                    style={ROW_MENU_STYLE}
                                  >
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors"
                                      onClick={() => runSubscriptionAction(row, 'extend-5')}
                                    >
                                      Продлить на 5 дней
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors"
                                      onClick={() => runSubscriptionAction(row, 'extend-30')}
                                    >
                                      Продлить на 30 дней
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors"
                                      onClick={() => runSubscriptionAction(row, 'extend-forever')}
                                    >
                                      Выдать навсегда
                                    </button>
                                    <div className="border-t border-slate-100" />
                                    {row.id && row._crmSubscription ? (
                                      <button
                                        type="button"
                                        className="w-full px-4 py-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                                        onClick={() => runSubscriptionAction(row, 'kick')}
                                      >
                                        Удалить из группы
                                      </button>
                                    ) : null}
                                  </div>
                                </>
                              ) : null}
                              {row.tg_user_id && (
                                <>
                                  <button className="p-2 bg-white border border-border-default text-ink-faint hover:text-action-primary hover:border-indigo-200 hover:bg-indigo-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(row.tg_user_id, '', '')} title="Написать через юзербота" aria-label="Написать через юзербота">
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <a className="p-2 bg-white border border-border-default text-ink-faint hover:text-ink-strong hover:bg-surface-subtle hover:border-border-strong rounded-lg transition-all shadow-sm" href={row.href || '/paywall/customers'} target="_blank" rel="noreferrer" title="Открыть источник">
                                <ChevronRight className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-8 py-4 border-t border-slate-100 bg-surface-subtle/30 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex-1">
                  {activeRows.length > limit ? (
                    <button
                      className="w-full md:w-auto px-6 py-3 bg-white border border-border-default text-ink-body rounded-xl text-sm font-bold shadow-sm hover:bg-surface-subtle hover:border-border-strong transition-all flex items-center justify-center gap-2"
                      onClick={() => setLimit((prev) => prev + 80)}
                    >
                      Показать еще {Math.min(80, activeRows.length - limit)} из {activeRows.length - limit}
                    </button>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <a
                    href="/paywall/broadcast"
                    className="w-full md:w-auto px-6 py-3 bg-action-primary !text-action-primary-text rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-action-primary-hover transition-all flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Рассылка
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
    </>
  );
}
