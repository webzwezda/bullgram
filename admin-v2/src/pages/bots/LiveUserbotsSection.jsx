import { Trash2, ShieldCheck, AlertCircle } from 'lucide-react';
import { UserbotSaleComposer } from './UserbotSaleComposer.jsx';

export function LiveUserbotsSection({
  accountBindingFeedback,
  accountCheckReport,
  accountDeleteFeedback,
  accountRestoreFeedback,
  availableBindingProxiesForAccount,
  availableFailoverProxiesForAccount,
  bindings,
  canRestoreFromFiles,
  canSellUserbotAssets,
  checkAccount,
  defaultCheckLines,
  deleteAccount,
  formatWhen,
  liveUserbots,
  openSaleComposer,
  proxyLabel,
  recoveryStatusBadge,
  resetSaleComposer,
  restoreAccount,
  restrictedMarker,
  saleComposer,
  saveBinding,
  saveUserbotSaleLot,
  selectedLiveUserbot,
  setSaleComposer,
  setSelectedLiveUserbotId,
  state,
  toggleSafeMode,
  toggleSalePaymentMethod,
  updateBinding
}) {
  return (
    <div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        {liveUserbots.length === 0 || !selectedLiveUserbot ? (
          <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
            <div className="text-[14px] font-medium text-slate-500">Боевых юзерботов пока нет.<br/>Сначала подключи аккаунт выше.</div>
          </div>
        ) : (
          (() => {
            const account = selectedLiveUserbot;
            const proxy = state.proxies.find((item) => String(item.id) === String(account.proxy_id));
            const restrictedBadge = restrictedMarker(account);
            const recovery = state.recoveryMap[String(account.id)];
            const recoveryBadge = recoveryStatusBadge(recovery);
            const failoverOptions = availableFailoverProxiesForAccount(account);
            const selectedBinding = bindings[account.id] || {
              proxy_id: account.proxy_id ? String(account.proxy_id) : '',
              allow_proxy_failover: !!account.allow_proxy_failover,
              failover_proxy_ids: Array.isArray(account.failover_proxy_ids) ? account.failover_proxy_ids.map(String) : []
            };
            const runtimeStatus = String(account.runtime_status || '');
            const hasRecoveryInfo = !!(recovery?.last_restored_at || recovery?.last_restore_error);
            const showRecoveryNextStep = !recovery && ['expired', 'error'].includes(runtimeStatus);

            return (
              <div className="space-y-6">
                <div>
                  <div>
                    <div className="mb-6 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">
                          Боевые аккаунты
                        </div>
                        <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-slate-600">
                          {liveUserbots.length}
                        </span>
                      </div>
                      <button
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-[13px] font-semibold text-rose-700 transition hover:bg-rose-100 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
                        onClick={() => deleteAccount(account)}
                        disabled={state.deletingAccountId === String(account.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                      </button>
                    </div>
                    <div className="w-full lg:max-w-[420px]">
                      <select
                        className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                        value={String(account.id)}
                        onChange={(event) => setSelectedLiveUserbotId(event.target.value)}
                      >
                        {liveUserbots.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.tg_username ? `@${item.tg_username}` : `TG ID ${item.tg_account_id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="space-y-4">
                    <div className="rounded-[24px] bg-slate-50/50 p-6 border border-slate-100/80 shadow-inner">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-[24px] font-black tracking-tight text-slate-900">
                            {account.tg_username ? `@${account.tg_username}` : 'без username'}
                          </div>
                          <div className="mt-1 text-[14px] text-slate-500">TG ID {account.tg_account_id}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {restrictedBadge ? <span className={restrictedBadge.className}>{restrictedBadge.text}</span> : null}
                          {recoveryBadge ? <span className={recoveryBadge.className}>{recoveryBadge.text}</span> : null}
                        </div>
                      </div>
                      {runtimeStatus === 'pending_activation' ? (
                        <div className="mt-4 flex items-start gap-2.5 rounded-[16px] border border-amber-200/50 bg-amber-50/50 px-4 py-3">
                        <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-[13px] font-medium text-amber-800">
                          Сейчас это safe-mode. В работу зайдет только после живой активации.
                        </div>
                      </div>
                      ) : restrictedBadge?.detail ? (
                        <div className="mt-4 text-[14px] text-rose-600">{restrictedBadge.detail}</div>
                      ) : account.runtime_error && ['restricted', 'dead_proxy', 'expired', 'error'].includes(runtimeStatus) ? (
                        <div className="mt-4 flex items-start gap-2.5 rounded-[16px] border border-rose-200/50 bg-rose-50/50 px-4 py-3">
                        <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                        <div className="text-[13px] font-medium text-rose-800">
                          {account.runtime_error}
                        </div>
                      </div>
                      ) : null}

                      <div className="mt-4 rounded-[20px] border border-slate-200/60 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                        <ShieldCheck className="w-4 h-4 text-slate-400" />
                        <div className="text-[14px] font-bold text-slate-900">Прокси сейчас</div>
                      </div>
                        {proxy ? (
                          <div className="mt-3 space-y-3 text-[14px]">
                            <div className="rounded-[14px] bg-slate-50 px-3 py-3">
                              <div className="font-medium text-slate-900">{proxy.name}</div>
                              <div className="mt-1 text-[13px] text-slate-500">
                                Выпадающее меню ниже показывает текущий прокси и позволяет сразу сменить его без лишних деталей.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2.5 rounded-[12px] border border-amber-200/50 bg-amber-50/50 px-3.5 py-3">
                          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <div className="text-[13px] font-bold text-amber-900">Прокси не назначен</div>
                            <div className="text-[12px] font-medium text-amber-700/80">Без него этот аккаунт в работу не пускай.</div>
                          </div>
                        </div>
                        )}

                        <label className="mt-4 block">
                          <select
                            className="h-11 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-4 text-[13px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                            value={selectedBinding.proxy_id || ''}
                            onChange={(event) => updateBinding(account.id, { proxy_id: event.target.value })}
                          >
                            <option value="">Выбери живой прокси</option>
                            {availableBindingProxiesForAccount(account).map((item) => (
                              <option key={item.id} value={item.id}>
                                {proxyLabel(item)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {hasRecoveryInfo ? (
                        <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4 text-[14px] text-slate-600">
                          <div className="text-[15px] font-semibold text-slate-900">Восстановление</div>
                          <div className="mt-3 space-y-2">
                            {recovery?.last_restored_at ? (
                              <div>Последний подъем: <span className="text-slate-900">{formatWhen(recovery.last_restored_at)}</span></div>
                            ) : null}
                            {recovery?.last_restore_error ? (
                              <div className="text-rose-600">Последняя ошибка: {recovery.last_restore_error}</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {showRecoveryNextStep ? (
                        <div className="mt-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
                          Для подъема нужен импорт `.session` и, если есть, `.json`.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-4">
                      <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-[15px] font-semibold text-slate-900">Проверка Telegram</div>
                            <div className="mt-1 text-[12px] text-slate-500">
                              Здесь запускается живая проверка сессии или активация fresh-аккаунта.
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {(() => {
                              const isSafeMode = String(account.runtime_status || '') === 'pending_activation';
                              const isCombatMode = !isSafeMode;
                              return (
                                <>
                                  <div className="text-[12px] font-medium text-slate-500">Боевой режим</div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={isCombatMode}
                                    aria-label="Боевой режим"
                                    onClick={() => toggleSafeMode(account)}
                                    disabled={state.togglingSafeModeId === String(account.id) || state.checkingAccountId === String(account.id)}
                                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                                      isCombatMode ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                  >
                                    <span
                                      className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                        isCombatMode ? 'translate-x-5' : 'translate-x-0'
                                      }`}
                                    />
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className="inline-flex h-11 items-center justify-center rounded-[14px] bg-slate-900 px-4 text-[14px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                            onClick={() => checkAccount(account)}
                            disabled={state.checkingAccountId === String(account.id) || state.togglingSafeModeId === String(account.id)}
                          >
                            {state.checkingAccountId === String(account.id)
                              ? 'Проверяем Telegram...'
                              : (account.runtime_status === 'pending_activation' ? 'Активировать' : 'Проверить Telegram')}
                          </button>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {(accountCheckReport.accountId === String(account.id) && accountCheckReport.lines.length
                            ? accountCheckReport.lines
                            : defaultCheckLines()
                          ).map((line, index) => (
                            <div
                              key={`${line.label}-${index}`}
                              className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                                line.tone === 'error'
                                  ? 'bg-rose-50'
                                  : line.tone === 'warning'
                                    ? 'bg-amber-50'
                                    : line.tone === 'success'
                                      ? 'bg-emerald-50'
                                      : 'bg-slate-100'
                              }`}
                            >
                              <div className={`text-[12px] font-medium ${
                                line.tone === 'error'
                                  ? 'text-rose-700'
                                  : line.tone === 'warning'
                                    ? 'text-amber-700'
                                    : line.tone === 'success'
                                      ? 'text-emerald-700'
                                      : 'text-slate-600'
                              }`}>
                                {line.label}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-[15px] font-semibold text-slate-900">Автозамена прокси</div>
                            <div className="mt-1 text-[12px] text-slate-500">
                              Если основной прокси умрет, можно быстро переехать на запасной.
                            </div>
                          </div>
                          <div className="shrink-0">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={selectedBinding.allow_proxy_failover}
                              aria-label="Автозамена прокси"
                              onClick={() => updateBinding(account.id, { allow_proxy_failover: !selectedBinding.allow_proxy_failover })}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                                selectedBinding.allow_proxy_failover ? 'bg-emerald-500' : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                  selectedBinding.allow_proxy_failover ? 'translate-x-5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {selectedBinding.allow_proxy_failover ? (
                          <div className="mt-4 rounded-[16px] bg-slate-50/80 p-4">
                            <div className="mb-2 text-[13px] font-medium text-slate-700">Запасные прокси</div>
                            {failoverOptions.length ? (
                              <>
                                <select
                                  className="min-h-[120px] w-full rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none transition focus:border-blue-500"
                                  multiple
                                  value={(selectedBinding.failover_proxy_ids || []).filter((id) =>
                                    failoverOptions.some((item) => String(item.id) === String(id))
                                  )}
                                  onChange={(event) => updateBinding(account.id, {
                                    failover_proxy_ids: Array.from(event.target.selectedOptions).map((option) => option.value)
                                  })}
                                >
                                  {failoverOptions.map((item) => (
                                    <option key={item.id} value={item.id}>{proxyLabel(item)}</option>
                                  ))}
                                </select>
                                <div className="mt-2 text-[12px] text-slate-500">
                                  Выбери, куда можно переехать, если основной прокси умрет.
                                </div>
                              </>
                            ) : (
                              <div className="text-[14px] text-slate-500">Других живых прокси сейчас нет</div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-4 text-[13px] text-slate-500">Сейчас запасные прокси не используются.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-[14px] bg-emerald-600 px-5 text-[14px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                    onClick={() => saveBinding(account.id)}
                    disabled={state.bindingAccountId === String(account.id)}
                  >
                    {state.bindingAccountId === String(account.id) ? 'Сохраняем...' : 'Сохранить'}
                  </button>
                  <div className="flex items-center gap-2">
                    {canRestoreFromFiles(account, recovery) ? (
                      <button
                        className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => restoreAccount(account)}
                        disabled={state.restoringAccountId === String(account.id)}
                      >
                        {state.restoringAccountId === String(account.id) ? 'Поднимаем...' : 'Восстановить'}
                      </button>
                    ) : null}
                    {canSellUserbotAssets ? (
                      <button
                        type="button"
                        className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        onClick={() => {
                          if (saleComposer.accountId === String(account.id)) {
                            resetSaleComposer();
                          } else {
                            openSaleComposer(account);
                          }
                        }}
                      >
                        {saleComposer.accountId === String(account.id) ? 'Скрыть продажу' : 'Продать'}
                      </button>
                    ) : null}
                    <button
                      className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      onClick={() => { window.location.href = `/app/userbot-center?userbot_id=${encodeURIComponent(account.id)}`; }}
                    >
                      Центр
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {accountBindingFeedback.accountId === String(account.id) && accountBindingFeedback.text ? (
                    <div className={`userbots-status-note userbots-status-note--${accountBindingFeedback.tone || 'default'}`}>
                      {accountBindingFeedback.text}
                    </div>
                  ) : null}
                  {accountRestoreFeedback.accountId === String(account.id) && accountRestoreFeedback.text ? (
                    <div className={`userbots-status-note userbots-status-note--${accountRestoreFeedback.tone || 'default'}`}>
                      {accountRestoreFeedback.text}
                    </div>
                  ) : null}
                  {accountDeleteFeedback.accountId === String(account.id) && accountDeleteFeedback.text ? (
                    <div className={`userbots-status-note userbots-status-note--${accountDeleteFeedback.tone || 'default'}`}>
                      {accountDeleteFeedback.text}
                    </div>
                  ) : null}
                </div>

                {canSellUserbotAssets && saleComposer.accountId === String(account.id) ? (
                  <UserbotSaleComposer
                    account={account}
                    resetSaleComposer={resetSaleComposer}
                    saleComposer={saleComposer}
                    saveUserbotSaleLot={saveUserbotSaleLot}
                    setSaleComposer={setSaleComposer}
                    toggleSalePaymentMethod={toggleSalePaymentMethod}
                  />
                ) : null}
              </div>
            );
          })()
        )}
    </div>
  );
}
