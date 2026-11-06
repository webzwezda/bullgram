import { Search, Filter, CheckCircle2, Clock } from 'lucide-react';
import { TABS, plural } from '../utils/customersRows.js';

function formatTon(amount) {
  const n = Number(amount || 0);
  return `${n.toFixed(2)} TON`;
}

export function CustomersHeader({
  state,
  stats,
  subscriptionCaps,
  selectedBotId,
  moneyPeriod,
  setMoneyPeriod,
  botAnalytics,
  activeTab,
  audienceState,
  setTabState,
  setSearchParams,
  search,
  setSearch
}) {
  return (
    <>
        <section className="p-6 md:p-8 border-b border-slate-100">
          {/* Фуннельные карточки. [display:grid] вместо grid — legacy .grid из app.css перебивает Tailwind-колонки */}
          <div className="[display:grid] grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Активный доступ', value: stats.activeCustomers, icon: CheckCircle2, color: 'text-emerald-600' },
              { label: 'Доступ закончился', value: stats.expiredCustomers, icon: Clock, color: stats.expiredCustomers > 0 ? 'text-ink-strong' : 'text-ink-muted' }
            ].map((item, idx) => (
              <div
                key={idx}
                className="bg-surface-subtle/50 border border-slate-100 p-6 rounded-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black uppercase tracking-widest text-ink-muted">{item.label}</span>
                  <item.icon className={`w-5 h-5 ${item.color} opacity-70`} />
                </div>
                <div
                  className={`text-3xl font-black tracking-tighter ${item.color}`}
                  title={subscriptionCaps?.truncated ? `Показаны последние ${subscriptionCaps.limit} ${plural(subscriptionCaps.limit, 'запись', 'записи', 'записей')}` : undefined}
                >
                  {item.value}{subscriptionCaps?.truncated ? '+' : ''}
                </div>
              </div>
            ))}
          </div>

          {selectedBotId ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-6 mb-3">
                <div className="text-xs font-black uppercase tracking-widest text-ink-muted">Выручка TON</div>
                <div className="flex rounded-xl border border-border-default overflow-hidden">
                  {[
                    { id: '7', label: '7 дней' },
                    { id: '30', label: '30 дней' },
                    { id: 'all', label: 'За всё время' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setMoneyPeriod(p.id)}
                      className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                        moneyPeriod === p.id ? 'bg-action-primary text-action-primary-text' : 'bg-white text-slate-600 hover:bg-surface-subtle'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-white border border-slate-100 border-l-4 border-l-indigo-400 p-6 rounded-2xl">
                <div className="text-3xl font-black tracking-tighter text-ink-strong tabular-nums">
                  {botAnalytics.data ? formatTon(moneyPeriod === 'all' ? botAnalytics.data.revenueTON : (botAnalytics.data.revenuePeriodTON ?? 0)) : '—'}
                </div>
                <div className="text-xs font-medium mt-1">
                  {botAnalytics.error && !botAnalytics.data
                    ? <span className="text-red-500">{botAnalytics.error}</span>
                    : botAnalytics.data && Number(moneyPeriod === 'all' ? botAnalytics.data.revenueTON : (botAnalytics.data.revenuePeriodTON ?? 0)) > 0
                      ? <span className="text-ink-muted">{moneyPeriod === '7' ? 'За 7 дней' : moneyPeriod === '30' ? 'За 30 дней' : 'За всё время'}</span>
                      : <span className="text-ink-strong">За период платежей нет</span>}
                </div>
              </div>
            </>
          ) : null}
        </section>

        {/* Filter & Search Section */}
        <section className="p-6 md:p-8 bg-surface-subtle/50 border-t border-border-default/60">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white shrink-0">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-ink-strong tracking-tight">Фильтры и поиск</h3>
              <p className="text-sm text-ink-muted font-medium mt-0.5">Выберите сегмент клиентов</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 mb-6">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isAudience = tab.id.startsWith('audience-');
              const targetType = isAudience ? tab.id.replace('audience-', '').replace(/-/g, '_') : null;
              const audienceTarget = isAudience ? audienceState.targets.find((t) => t.targetType === targetType) : null;
              const count = isAudience
                ? (audienceTarget?.totalMembers || 0)
                : tab.id === 'bot' ? stats.started : null;
              const isDisabled = isAudience && !audienceState.loading && audienceTarget && !audienceTarget.channelId;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={isDisabled ? 'Группа не в контуре продаж — подключите её на экране «Бот продаж»' : undefined}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                    isActive
                      ? 'border-indigo-600 text-action-primary'
                      : isDisabled
                        ? 'border-transparent text-ink-muted opacity-50 cursor-not-allowed'
                        : 'border-transparent text-ink-muted hover:text-ink-body hover:border-border-strong'
                  }`}
                  onClick={() => !isDisabled && setTabState(tab.id)}
                  disabled={!!isDisabled}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {tab.label}
                  {count !== null && count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-indigo-100 text-action-primary' : 'bg-surface-subtle-strong text-ink-muted'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search & Actions */}
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full">
              <input
                className="w-full pl-12 pr-6 py-3.5 bg-white border border-border-default rounded-xl text-ink-strong font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm text-sm"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeTab.startsWith('audience-') ? 'Поиск по TG ID, @username…' : 'Поиск по TG ID, @username, тарифу…'}
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
            </div>
            <div className="w-full md:w-[280px] shrink-0">
              <select
                className="w-full px-4 py-3.5 bg-white border border-border-default rounded-xl text-ink-strong font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm text-sm"
                value={selectedBotId}
                onChange={(event) => {
                  const next = new URLSearchParams(window.location.search);
                  // Страница per-bot: мёртвый «Все боты» убрали, всегда фиксируем bot_id
                  next.set('bot_id', event.target.value);
                  setSearchParams(next);
                }}
              >
                {state.bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.label}{bot.status === 'deleted' ? ' • удален' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
    </>
  );
}
