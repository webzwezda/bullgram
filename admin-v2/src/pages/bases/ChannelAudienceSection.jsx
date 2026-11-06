import { Fragment } from 'react';
import { ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { MEMBER_FILTERS } from './shared.js';
import { AudienceMembersTable } from './AudienceMembersTable.jsx';

export function ChannelAudienceSection({ selectedChannel, memberSummary, coverageStats, filteredMembers, filter, onFilterChange, search, onSearchChange, targetLabel, membersLoading, membersTotal, onAddToBase, addToBaseDisabled, userbots, selectedUserbotId, onUserbotChange, syncing, activeBaseId, onSync, onCreateAudience }) {
  const statCards = [
    { label: 'Людей в базе', value: memberSummary.total || 0, color: 'text-slate-900' },
    { label: 'Активно платят', value: memberSummary.active_paid || 0, color: (memberSummary.active_paid || 0) > 0 ? 'text-emerald-600' : 'text-slate-500' },
    { label: 'Без подписки', value: memberSummary.free_riders || 0, color: (memberSummary.free_riders || 0) > 0 ? 'text-rose-600' : 'text-slate-500' },
    { label: 'Неполное покрытие', value: coverageStats.partial, color: coverageStats.partial > 0 ? 'text-amber-600' : 'text-slate-500' }
  ];

  return selectedChannel ? (
    selectedChannel.linked_base_id ? (
      <Fragment>
        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map((card, idx) => (
              <div key={idx} className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">{card.label}</div>
                <div className={`text-3xl font-black tracking-tighter ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">Участники канала</h3>
            <div className="flex flex-wrap items-center gap-2">
              {targetLabel ? (
                <span className="inline-flex items-center bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2.5 py-1 text-[11px] font-bold">
                  Куда попадёт «В базу»: {targetLabel}
                </span>
              ) : null}
              <span className="text-xs font-bold text-slate-500">
                {filteredMembers.length} показываем
                {(memberSummary.total || membersTotal) > filteredMembers.length ? ` · ${memberSummary.total || membersTotal} всего` : ''}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
            {MEMBER_FILTERS.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onFilterChange(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              type="text"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Имя, @username или TG ID"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-slate-400"
            />
          </div>

          {membersLoading && membersTotal === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Грузим участников...
            </div>
          ) : (
            <AudienceMembersTable
              members={filteredMembers}
              onCopyToBase={onAddToBase}
              addToBaseDisabled={addToBaseDisabled}
            />
          )}
        </section>

        <section className="p-6 md:p-8">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-4">Синк из групп через юзербота</h3>
          {userbots.length === 0 ? (
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-amber-800">
              <div className="font-bold mb-1">Нет подключённого юзербота</div>
              <div className="text-sm opacity-90 mb-3">
                Без юзербота синк из групп недоступен. Подключите аккаунт в приложении «Юзербот».
              </div>
              <a href="/userbot/accounts" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 !text-white hover:bg-slate-700 transition-colors">
                Открыть Юзерботы <ChevronRight className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <Fragment>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <select
                  value={selectedUserbotId}
                  onChange={(event) => onUserbotChange(event.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[320px]"
                >
                  {userbots.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.tg_username ? `@${u.tg_username}` : `ID ${u.tg_account_id}`}
                      {u.proxy_country ? ` · ${u.proxy_country}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onSync}
                  disabled={!activeBaseId || syncing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Синхронизация...' : 'Запустить синк'}
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                Берёт актуальных участников из привязанных каналов и групп, сопоставляет с подписками и обновляет покрытие базы. Безопасно запускать повторно — старые записи не удаляются, только обновляется <code className="px-1 bg-slate-100 rounded">present_now</code>.
              </p>
            </Fragment>
          )}
        </section>
      </Fragment>
    ) : (
      <section className="p-6 md:p-8">
        <div className="p-5 rounded-2xl bg-amber-50/60 border border-amber-200">
          <div className="font-bold text-amber-800 mb-1">У этого канала ещё нет базы аудитории</div>
          <div className="text-sm text-amber-700 mb-4">
            Создайте базу и привяжите канал, чтобы синкать участников через юзербота.
          </div>
          <button
            type="button"
            onClick={onCreateAudience}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Создать аудиторию для канала
          </button>
        </div>
      </section>
    )
  ) : (
    <section className="p-6 md:p-8">
      <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
        Выберите канал выше, чтобы увидеть участников.
      </div>
    </section>
  );
}
