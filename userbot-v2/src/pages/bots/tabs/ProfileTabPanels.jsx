import { Activity, AlertCircle, KeyRound, Loader2, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CollapsiblePanelHeader, ModernSwitch, StatusBadge } from '../components/CenterWidgets.jsx';

export function ConnectionPanel({ open, onToggle, binding, updateBinding, selectedLiveUserbot, availableBindingProxiesForAccount, proxyLabel, availableFailoverProxiesForAccount }) {
  return (
            <div>
              <CollapsiblePanelHeader
                icon={Network}
                iconClassName="w-4 h-4 text-indigo-500"
                title="Соединение"
                open={open}
                onToggle={onToggle}
              />
              {open ? (
              <div className="bg-surface-subtle border border-slate-100 rounded-2xl p-4 space-y-4 shadow-sm">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Основной прокси</label>
                  <Select
                    value={binding?.proxy_id || ''}
                    onValueChange={(value) => updateBinding(selectedLiveUserbot.id, { proxy_id: value })}
                  >
                    <SelectTrigger className={`w-full rounded-xl shadow-sm ${binding?.proxy_id ? 'bg-white border-slate-200' : 'border-rose-300 bg-rose-50/40'}`}>
                      {binding?.proxy_id ? (
                        <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      )}
                      <SelectValue placeholder="Не назначен — выбрать..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {availableBindingProxiesForAccount(selectedLiveUserbot).map((item) => (
                        <SelectItem key={item.id} value={item.id} className="rounded-lg">
                          {proxyLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-px w-full bg-slate-200/60 my-2"></div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Автозамена прокси</label>
                      <p className="text-[11px] text-ink-muted mt-0.5">Переезд при падении основного</p>
                    </div>
                    <ModernSwitch
                      checked={!!binding?.allow_proxy_failover}
                      onChange={() => updateBinding(selectedLiveUserbot.id, { allow_proxy_failover: !binding?.allow_proxy_failover })}
                      activeColor="bg-emerald-500"
                    />
                  </div>

                  {binding?.allow_proxy_failover && (
                    <div className="pt-2 animate-in fade-in slide-in-from-top-1">
                      {(() => {
                        const failoverOptions = availableFailoverProxiesForAccount(selectedLiveUserbot);
                        return failoverOptions.length ? (
                          <select
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-shadow min-h-[100px]"
                            multiple
                            value={(binding?.failover_proxy_ids || []).filter((id) =>
                              failoverOptions.some((item) => String(item.id) === String(id))
                            )}
                            onChange={(event) => updateBinding(selectedLiveUserbot.id, {
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
              </div>
              ) : null}
            </div>
  );
}

export function SessionPanel({ open, onToggle, isCombatMode, toggleSafeMode, selectedLiveUserbot, checkingAccountId, togglingSafeModeId, isSafeMode, accountCheckReport, defaultCheckLines }) {
  return (
            <div>
              <CollapsiblePanelHeader
                icon={Activity}
                iconClassName="w-4 h-4 text-emerald-500"
                title="Состояние сессии"
                open={open}
                onToggle={onToggle}
              />
              {open ? (
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Боевой режим</p>
                    <p className="text-xs text-slate-500 mt-0.5">Выключите для перевода в Safe Mode</p>
                  </div>
                  <ModernSwitch
                    checked={isCombatMode}
                    onChange={() => toggleSafeMode(selectedLiveUserbot)}
                    disabled={checkingAccountId === String(selectedLiveUserbot.id) || togglingSafeModeId === String(selectedLiveUserbot.id)}
                    activeColor="bg-emerald-500"
                  />
                </div>

                <Button
                  className="w-full rounded-xl shadow-sm"
                  size="lg"
                  onClick={() => checkAccount(selectedLiveUserbot)}
                  disabled={checkingAccountId === String(selectedLiveUserbot.id) || togglingSafeModeId === String(selectedLiveUserbot.id)}
                  variant={isSafeMode ? "default" : "secondary"}
                >
                  {checkingAccountId === String(selectedLiveUserbot.id) || togglingSafeModeId === String(selectedLiveUserbot.id) ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isSafeMode ? 'Активация...' : 'Проверка...'}</>
                  ) : (
                    isSafeMode ? 'Выполнить активацию' : 'Проверить Telegram'
                  )}
                </Button>

                <div className="flex flex-wrap gap-2 pt-1">
                  {(accountCheckReport.accountId === String(selectedLiveUserbot.id) && accountCheckReport.lines.length
                    ? accountCheckReport.lines
                    : defaultCheckLines()
                  ).map((line, index) => (
                    <StatusBadge key={`${line.label}-${index}`} tone={line.tone}>
                      {line.label}
                    </StatusBadge>
                  ))}
                </div>
              </div>
              ) : null}
            </div>
  );
}

export function RecoveryPanel({ recovery, formatWhen, showRecoveryNextStep, canRestoreFromFiles, selectedLiveUserbot, restoreAccount, restoringAccountId, accountRestoreFeedback }) {
  return (
            <div className="p-6 md:p-8 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3 px-1">
                <KeyRound className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-900">Восстановление</h3>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
                {recovery?.last_restored_at && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Последний подъем:</span>
                    <span className="font-medium text-slate-900">{formatWhen(recovery.last_restored_at)}</span>
                  </div>
                )}
                {recovery?.last_restore_error && (
                  <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">
                    Ошибка: {recovery.last_restore_error}
                  </p>
                )}
                {showRecoveryNextStep && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Для подъема нужен импорт <code className="font-mono bg-white px-1 py-0.5 rounded text-xs">.session</code> и <code className="font-mono bg-white px-1 py-0.5 rounded text-xs">.json</code>.
                  </div>
                )}
                {canRestoreFromFiles(selectedLiveUserbot, recovery) && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full rounded-xl border-slate-200 hover:bg-slate-50"
                    onClick={() => restoreAccount(selectedLiveUserbot)}
                    disabled={restoringAccountId === String(selectedLiveUserbot.id)}
                  >
                    {restoringAccountId === String(selectedLiveUserbot.id) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {restoringAccountId === String(selectedLiveUserbot.id) ? 'Поднимаем...' : 'Восстановить'}
                  </Button>
                )}
                {accountRestoreFeedback.accountId === String(selectedLiveUserbot.id) && accountRestoreFeedback.text && (
                  <div className="p-3 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-100 text-sm font-medium animate-in slide-in-from-bottom-2">
                    {accountRestoreFeedback.text}
                  </div>
                )}
              </div>
            </div>
  );
}
