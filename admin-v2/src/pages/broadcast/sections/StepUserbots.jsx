import { Bot } from 'lucide-react';
import { Card, Section, SectionTitle, EmptyNote, StatusBadge } from '../ui.jsx';

export function StepUserbots({
  step,
  state,
  poolIds,
  setPoolIds,
  eligibleUserbots,
  allSelected,
  togglePoolUserbot,
  capacity,
  audienceSize,
  preparation,
  selectionMatchesPreparation
}) {
  return (
    <>
      {step === 'userbots' ? (
        <Card>
          <Section>
            <SectionTitle icon={Bot}>Юзерботы</SectionTitle>
            <div className="text-sm text-slate-500 font-medium mb-4">
              Рассылка пойдёт от имени выбранных аккаунтов. Safe-mode и аккаунты с недоступным прокси не участвуют.
            </div>
            {state.userbots.length === 0 ? (
              <EmptyNote>
                Нет юзерботов.{' '}
                <a href="/userbot/accounts" className="text-indigo-600 font-bold hover:text-indigo-700">Подключить аккаунты</a>
              </EmptyNote>
            ) : (
              <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Выбрано: {poolIds.length} из {eligibleUserbots.length}
                </span>
                {eligibleUserbots.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                    onClick={() => setPoolIds(allSelected ? [] : eligibleUserbots.map((row) => row.id))}
                  >
                    {allSelected ? 'Снять всех' : 'Выбрать всех'}
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {state.userbots.map((row) => {
                  const safeMode = row.runtime_status === 'pending_activation';
                  const deadProxy = row.proxy_id && row.proxies?.is_working === false;
                  const checked = poolIds.map(String).includes(String(row.id));
                  return (
                    <label
                      key={row.id}
                      className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                        checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${safeMode || deadProxy ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 truncate">@{row.tg_username || row.tg_account_id}</div>
                        <div className="text-xs text-slate-500 font-medium mt-0.5 flex flex-wrap items-center gap-2">
                          {safeMode ? <StatusBadge tone="warning">safe-mode</StatusBadge> : null}
                          {deadProxy ? <StatusBadge tone="danger">прокси недоступен</StatusBadge> : null}
                          {!safeMode && !deadProxy ? (
                            <span>
                              {row.proxies?.host ? `${row.proxies.host}:${row.proxies.port}` : 'Прокси не найден'}
                              {row.proxies?.last_check_country ? ` • ${row.proxies.last_check_country}` : ''}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-slate-900 shrink-0"
                        disabled={safeMode || deadProxy}
                        checked={checked}
                        onChange={() => togglePoolUserbot(row.id)}
                      />
                    </label>
                  );
                })}
              </div>
              </div>
            )}
            {capacity && audienceSize > 0 && capacity.poolSize === 0 ? (
              <div className="mt-4 rounded-2xl border border-border-default bg-feedback-warning-bg px-4 py-3 text-sm font-bold text-feedback-warning-text">
                Рабочих юзерботов нет — рассылать некому. Подключи хотя бы одного в приложении «Юзербот» —{' '}
                <a href="/userbot/accounts" className="underline hover:opacity-80">/userbot/accounts</a>
                : базе на {capacity.audienceSize} контактов нужно ~{capacity.botsNeeded} юзерботов на один день.
              </div>
            ) : null}
            {capacity && audienceSize > 0 && capacity.poolSize > 0 && capacity.days != null ? (
              capacity.days <= 1 ? (
                <div className="mt-4 rounded-2xl border border-border-default bg-surface-subtle px-4 py-3 text-sm font-medium text-ink-body">
                  Пул потянет базу за ~1 день — безопасный темп ~{capacity.dailyCap} ЛС/день на юзербота.
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-border-default bg-feedback-warning-bg px-4 py-3 text-sm font-bold text-feedback-warning-text">
                  Базе на {capacity.audienceSize} контактов нужно ~{capacity.botsNeeded} юзерботов, чтобы разойтись за день.
                  У тебя {capacity.poolSize} — растянется на ~{capacity.days} дн. Это нормально: роутер сам держит
                  безопасный темп, чтобы Telegram не забанил аккаунты.
                </div>
              )
            ) : null}
            {preparation && !selectionMatchesPreparation ? (
              <div className="mt-4 text-sm text-amber-700 font-medium">
                Выбор изменился — нужна новая подготовка.
              </div>
            ) : null}
          </Section>
        </Card>
      ) : null}
    </>
  );
}
