import { Bot, Trash2, ShieldCheck, AlertCircle, Loader2, Settings2, ChevronRight, Activity, Network, KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserbotSaleComposer } from './UserbotSaleComposer.jsx';

function StatusBadge({ tone, children, className = '' }) {
  const colorMap = {
    success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    error: 'bg-rose-100 text-rose-800 border-rose-200',
    danger: 'bg-rose-100 text-rose-800 border-rose-200',
    ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    default: 'bg-slate-100 text-slate-700 border-slate-200'
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${colorMap[tone] || colorMap.default} ${className}`}>
      {children}
    </span>
  );
}

function ModernSwitch({ checked, onChange, disabled, activeColor = 'bg-indigo-600' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? activeColor : 'bg-slate-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

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
  const isChecking = state.checkingAccountId || state.togglingSafeModeId;
  const isDeleting = state.deletingAccountId;
  const isSaving = state.bindingAccountId;
  const isRestoring = state.restoringAccountId;

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 mb-6 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Боевые аккаунты
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {liveUserbots.length}
                </Badge>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Управление сессиями, прокси и чекинг</p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {liveUserbots.length > 0 && (
              <Select
                value={selectedLiveUserbot ? String(selectedLiveUserbot.id) : ''}
                onValueChange={(value) => setSelectedLiveUserbotId(value)}
              >
                <SelectTrigger className="w-full sm:w-[240px] bg-white border-slate-200 shadow-sm rounded-xl">
                  <SelectValue placeholder="Выбрать аккаунт" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {liveUserbots.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)} className="rounded-lg">
                      {item.tg_username ? `@${item.tg_username}` : `TG ID ${item.tg_account_id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {selectedLiveUserbot && (
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 rounded-xl"
                onClick={() => deleteAccount(selectedLiveUserbot)}
                disabled={isDeleting === String(selectedLiveUserbot.id)}
                title="Удалить аккаунт"
              >
                {isDeleting === String(selectedLiveUserbot.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {!selectedLiveUserbot ? (
        <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
            <Bot className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Нет выбранного аккаунта</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">
            {liveUserbots.length === 0 
              ? 'Боевых юзерботов пока нет. Сначала подключи аккаунт выше.' 
              : 'Выберите аккаунт из списка выше для управления.'}
          </p>
        </div>
      ) : (
        <div className="p-5 sm:p-6 bg-white space-y-6">
          {(() => {
            const account = selectedLiveUserbot;
            const proxy = state.proxies.find((item) => String(item.id) === String(account.proxy_id));
            const restrictedBadge = restrictedMarker(account);
            const recovery = state.recoveryMap[String(account.id)];
            const recoveryBadge = recoveryStatusBadge(recovery);
            const selectedBinding = bindings[account.id] || {
              proxy_id: account.proxy_id ? String(account.proxy_id) : '',
              allow_proxy_failover: !!account.allow_proxy_failover,
              failover_proxy_ids: Array.isArray(account.failover_proxy_ids) ? account.failover_proxy_ids.map(String) : []
            };
            const runtimeStatus = String(account.runtime_status || '');
            const hasRecoveryInfo = !!(recovery?.last_restored_at || recovery?.last_restore_error);
            const showRecoveryNextStep = !recovery && ['expired', 'error'].includes(runtimeStatus);
            const isSafeMode = runtimeStatus === 'pending_activation';
            const isCombatMode = !isSafeMode;

            return (
              <div className="space-y-6">
                {/* Hero Profile Banner */}
                <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/30 border border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Bot className="w-6 h-6 text-slate-700" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-slate-900 tracking-tight">
                          {account.tg_username ? `@${account.tg_username}` : 'Без username'}
                        </span>
                        <Badge variant="outline" className="bg-white text-slate-500 font-mono text-[10px] uppercase">
                          ID: {account.tg_account_id}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {restrictedBadge && <StatusBadge tone="error">{restrictedBadge.text}</StatusBadge>}
                        {recoveryBadge && <StatusBadge tone={recoveryBadge.tone || 'default'}>{recoveryBadge.text}</StatusBadge>}
                        {isSafeMode && <StatusBadge tone="warning">Safe mode</StatusBadge>}
                        {!restrictedBadge && !recoveryBadge && !isSafeMode && <StatusBadge tone="success">Активен</StatusBadge>}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm rounded-xl"
                    onClick={() => { window.location.href = `/app/userbot-center?userbot_id=${encodeURIComponent(account.id)}`; }}
                  >
                    Центр управления
                    <ChevronRight className="w-4 h-4 ml-1.5 text-slate-400" />
                  </Button>
                </div>

                {/* Status Alerts */}
                {isSafeMode ? (
                  <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-amber-900">Режим Safe Mode</h4>
                      <p className="text-sm text-amber-800 mt-0.5">
                        Аккаунт ожидает живой активации перед входом в боевой контур.
                      </p>
                    </div>
                  </div>
                ) : restrictedBadge?.detail ? (
                  <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-rose-900">Ограничения</h4>
                      <p className="text-sm text-rose-800 mt-0.5">{restrictedBadge.detail}</p>
                    </div>
                  </div>
                ) : account.runtime_error && ['restricted', 'dead_proxy', 'expired', 'error'].includes(runtimeStatus) ? (
                  <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-rose-900">Ошибка выполнения</h4>
                      <p className="text-sm text-rose-800 mt-0.5">{account.runtime_error}</p>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Left Column: Network & Proxy */}
                  <div className="flex flex-col">
                    <div className="flex flex-col flex-1">
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <Network className="w-4 h-4 text-indigo-500" />
                        <h3 className="text-sm font-bold text-slate-900">Соединение</h3>
                      </div>

                      <div className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4 shadow-sm">
                        {/* Primary Proxy */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Основной прокси</label>
                          <Select
                            value={selectedBinding.proxy_id || ''}
                            onValueChange={(value) => updateBinding(account.id, { proxy_id: value })}
                          >
                            <SelectTrigger className={`w-full rounded-xl shadow-sm ${selectedBinding.proxy_id ? 'bg-white border-slate-200' : 'border-rose-300 bg-rose-50/40'}`}>
                              {selectedBinding.proxy_id ? (
                                <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              )}
                              <SelectValue placeholder="Не назначен — выбрать..." />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                              {availableBindingProxiesForAccount(account).map((item) => (
                                <SelectItem key={item.id} value={item.id} className="rounded-lg">
                                  {proxyLabel(item)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="h-px w-full bg-slate-200/60 my-2"></div>

                        {/* Failover Proxies */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Автозамена прокси</label>
                              <p className="text-[11px] text-slate-400 mt-0.5">Переезд при падении основного</p>
                            </div>
                            <ModernSwitch 
                              checked={selectedBinding.allow_proxy_failover} 
                              onChange={() => updateBinding(account.id, { allow_proxy_failover: !selectedBinding.allow_proxy_failover })}
                              activeColor="bg-emerald-500"
                            />
                          </div>

                          {selectedBinding.allow_proxy_failover && (
                            <div className="pt-2 animate-in fade-in slide-in-from-top-1">
                              {(() => {
                                const failoverOptions = availableFailoverProxiesForAccount(account);
                                return failoverOptions.length ? (
                                  <select
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-shadow min-h-[100px]"
                                    multiple
                                    value={(selectedBinding.failover_proxy_ids || []).filter((id) =>
                                      failoverOptions.some((item) => String(item.id) === String(id))
                                    )}
                                    onChange={(event) => updateBinding(account.id, {
                                      failover_proxy_ids: Array.from(event.target.selectedOptions).map((option) => option.value)
                                    })}
                                  >
                                    {failoverOptions.map((item) => (
                                      <option key={item.id} value={item.id} className="py-1">{proxyLabel(item)}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="text-sm text-slate-500 bg-slate-100/50 rounded-xl p-3 border border-dashed border-slate-200 text-center">
                                    Нет доступных прокси
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>

                        <div className="pt-2">
                          <Button
                            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200"
                            size="lg"
                            onClick={() => saveBinding(account.id)}
                            disabled={isSaving === String(account.id)}
                          >
                            {isSaving === String(account.id) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Settings2 className="w-4 h-4 mr-2" />}
                            {isSaving === String(account.id) ? 'Сохранение...' : 'Сохранить настройки'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Session & Recovery */}
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col flex-1">
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <Activity className="w-4 h-4 text-emerald-500" />
                        <h3 className="text-sm font-bold text-slate-900">Состояние сессии</h3>
                      </div>

                      <div className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Боевой режим</p>
                            <p className="text-xs text-slate-500 mt-0.5">Выключите для перевода в Safe Mode</p>
                          </div>
                          <ModernSwitch
                            checked={isCombatMode}
                            onChange={() => toggleSafeMode(account)}
                            disabled={isChecking === String(account.id)}
                            activeColor="bg-emerald-500"
                          />
                        </div>

                        <Button
                          className="w-full rounded-xl shadow-sm"
                          size="lg"
                          onClick={() => checkAccount(account)}
                          disabled={isChecking === String(account.id)}
                          variant={isSafeMode ? "default" : "secondary"}
                        >
                          {isChecking === String(account.id) ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isSafeMode ? 'Активация...' : 'Проверка...'}</>
                          ) : (
                            isSafeMode ? 'Выполнить активацию' : 'Проверить Telegram'
                          )}
                        </Button>

                        <div className="flex flex-wrap gap-2 pt-1">
                          {(accountCheckReport.accountId === String(account.id) && accountCheckReport.lines.length
                            ? accountCheckReport.lines
                            : defaultCheckLines()
                          ).map((line, index) => (
                            <StatusBadge key={`${line.label}-${index}`} tone={line.tone}>
                              {line.label}
                            </StatusBadge>
                          ))}
                        </div>
                      </div>
                    </div>

                    {(hasRecoveryInfo || showRecoveryNextStep) && (
                      <div>
                        <div className="flex items-center gap-2 mb-3 px-1">
                          <KeyRound className="w-4 h-4 text-slate-500" />
                          <h3 className="text-sm font-bold text-slate-900">Восстановление</h3>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
                          {recovery?.last_restored_at && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-500">Последний подъем:</span>
                              <span className="font-medium text-slate-900">{formatWhen(recovery.last_restored_at)}</span>
                            </div>
                          )}
                          {recovery?.last_restore_error && (
                            <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg mt-2">
                              Ошибка: {recovery.last_restore_error}
                            </p>
                          )}
                          {showRecoveryNextStep && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                              Для подъема нужен импорт <code className="font-mono bg-white px-1 py-0.5 rounded text-xs">.session</code> и <code className="font-mono bg-white px-1 py-0.5 rounded text-xs">.json</code>.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div className="flex flex-wrap items-center gap-3 pt-4">
                  {canRestoreFromFiles(account, recovery) && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="rounded-xl border-slate-200 hover:bg-slate-50"
                      onClick={() => restoreAccount(account)}
                      disabled={isRestoring === String(account.id)}
                    >
                      {isRestoring === String(account.id) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      {isRestoring === String(account.id) ? 'Поднимаем...' : 'Восстановить'}
                    </Button>
                  )}
                  {canSellUserbotAssets && (
                    <Button
                      variant="secondary"
                      size="lg"
                      className="rounded-xl"
                      onClick={() => {
                        if (saleComposer.accountId === String(account.id)) {
                          resetSaleComposer();
                        } else {
                          openSaleComposer(account);
                        }
                      }}
                    >
                      {saleComposer.accountId === String(account.id) ? 'Скрыть продажу' : 'Продать аккаунт'}
                    </Button>
                  )}
                </div>

                {/* Feedback messages */}
                <div className="space-y-2 pt-2">
                  {accountBindingFeedback.accountId === String(account.id) && accountBindingFeedback.text && (
                    <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-100 text-sm font-medium animate-in slide-in-from-bottom-2">
                      {accountBindingFeedback.text}
                    </div>
                  )}
                  {accountRestoreFeedback.accountId === String(account.id) && accountRestoreFeedback.text && (
                    <div className="p-3 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-100 text-sm font-medium animate-in slide-in-from-bottom-2">
                      {accountRestoreFeedback.text}
                    </div>
                  )}
                  {accountDeleteFeedback.accountId === String(account.id) && accountDeleteFeedback.text && (
                    <div className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-100 text-sm font-medium animate-in slide-in-from-bottom-2">
                      {accountDeleteFeedback.text}
                    </div>
                  )}
                </div>

                {/* Sale composer */}
                {canSellUserbotAssets && saleComposer.accountId === String(account.id) && (
                  <div className="pt-4 animate-in fade-in zoom-in-95 duration-200">
                    <UserbotSaleComposer
                      account={account}
                      resetSaleComposer={resetSaleComposer}
                      saleComposer={saleComposer}
                      saveUserbotSaleLot={saveUserbotSaleLot}
                      setSaleComposer={setSaleComposer}
                      toggleSalePaymentMethod={toggleSalePaymentMethod}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </Card>
  );
}
