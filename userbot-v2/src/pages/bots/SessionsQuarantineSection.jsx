import { useState } from 'react';
import {
  AlertCircle, ExternalLink, Loader2, LogOut, RefreshCw, ShieldAlert, Smartphone
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserbotCombobox } from '@/components/bots/UserbotCombobox';
import { apiRequest } from '../../api/client.js';

function StatusBadge({ tone, children }) {
  const pairMap = {
    error: 'bg-feedback-error-bg text-feedback-error-text border-feedback-error-bg',
    warning: 'bg-feedback-warning-bg text-feedback-warning-text border-feedback-warning-bg',
    default: 'bg-surface-subtle text-ink-muted border-border-default'
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${pairMap[tone] || pairMap.default}`}>
      {children}
    </span>
  );
}

function formatDate(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

// Единая секция гигиены аккаунтов: таб «Активные сессии» (проверка залогиненных
// устройств выбранного юзербота) и таб «Отстойник» (проблемные аккаунты с
// закрытой продажей). Проблемные из основного селектора убраны — живут тут.
export function SessionsQuarantineSection({
  accessToken,
  selectedLiveUserbotId,
  quarantinedUserbots,
  selectedQuarantinedUserbot,
  setSelectedQuarantinedUserbotId,
  restrictedMarker,
  formatWhen,
  checkAccount,
  checkingAccountId
}) {
  const [activeTab, setActiveTab] = useState('sessions');
  const [authorizationsState, setAuthorizationsState] = useState({
    loading: false,
    error: '',
    rows: []
  });
  const [resetBusy, setResetBusy] = useState({ others: false, hash: '' });

  async function loadAuthorizations() {
    if (!accessToken || !selectedLiveUserbotId) {
      setAuthorizationsState({ loading: false, error: '', rows: [] });
      return;
    }
    setAuthorizationsState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const query = new URLSearchParams({ userbot_id: selectedLiveUserbotId });
      const data = await apiRequest(`/api/userbot/ops-center/authorizations?${query.toString()}`, { accessToken });
      setAuthorizationsState({
        loading: false,
        error: '',
        rows: data.authorizations || [],
        loaded: true
      });
    } catch (error) {
      setAuthorizationsState({
        loading: false,
        error: error.message,
        rows: []
      });
    }
  }

  async function resetOtherSessions() {
    if (!selectedLiveUserbotId) {
      toast.error('Сначала выбери юзербота.');
      return;
    }
    if (!window.confirm('Разлогинить все остальные устройства этого Telegram-аккаунта и оставить только текущую серверную сессию?')) {
      return;
    }
    setResetBusy((prev) => ({ ...prev, others: true }));
    try {
      const data = await apiRequest('/api/userbot/ops-center/authorizations/reset-others', {
        accessToken,
        method: 'POST',
        body: { userbot_id: selectedLiveUserbotId }
      });
      setAuthorizationsState({ loading: false, error: '', rows: data.authorizations || [] });
      toast.success(data.message || 'Остальные устройства разлогинены.');
    } catch (error) {
      toast.error(`Не получилось разлогинить остальные устройства: ${error.message}`);
    } finally {
      setResetBusy((prev) => ({ ...prev, others: false }));
    }
  }

  async function resetOneSession(row) {
    if (!selectedLiveUserbotId) {
      toast.error('Сначала выбери юзербота.');
      return;
    }
    if (!row?.hash) {
      toast.error('У этой сессии нет hash — её нельзя разлогинить точечно.');
      return;
    }
    if (row.current) {
      toast.error('Текущую серверную сессию нельзя разлогинить.');
      return;
    }
    const label = row.device_model || row.app_name || row.platform || 'устройство';
    if (!window.confirm(`Разлогинить «${label}»? На этом устройстве придётся заново входить в Telegram.`)) {
      return;
    }
    setResetBusy((prev) => ({ ...prev, hash: row.hash }));
    try {
      const data = await apiRequest('/api/userbot/ops-center/authorizations/reset-one', {
        accessToken,
        method: 'POST',
        body: {
          userbot_id: selectedLiveUserbotId,
          hash: row.hash
        }
      });
      setAuthorizationsState({ loading: false, error: '', rows: data.authorizations || [] });
      toast.success(data.message || 'Устройство разлогинено.');
    } catch (error) {
      toast.error(`Не получилось разлогинить устройство: ${error.message}`);
    } finally {
      setResetBusy((prev) => ({ ...prev, hash: '' }));
    }
  }

  function openTelegramWeb() {
    if (!selectedQuarantinedUserbot?.id) return;
    window.open(`/userbot/telegram-web/${selectedQuarantinedUserbot.id}`, '_blank', 'noopener');
  }

  const account = selectedQuarantinedUserbot;
  const marker = account ? restrictedMarker(account) : null;
  const isChecking = account && String(account.id) === String(checkingAccountId || '');
  const isError = marker?.className?.includes('danger');

  const renderTabButton = (id, label, icon, count = null) => {
    const active = activeTab === id;
    return (
      <Button
        variant={active ? 'outline' : 'ghost'}
        size="sm"
        className={`h-9 rounded-xl ${active ? 'shadow-sm text-ink-strong' : 'text-ink-muted'}`}
        onClick={() => setActiveTab(id)}
      >
        {icon}
        {label}
        {count !== null && count > 0 && (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-surface-card"
            style={{ backgroundColor: 'var(--color-feedback-error-text)' }}
          >
            {count}
          </span>
        )}
      </Button>
    );
  };

  return (
    <Card className="border-0 shadow-lg ring-1 ring-border-default mt-6 mb-6 bg-surface-card overflow-hidden rounded-2xl">
      <div className="bg-surface-subtle/50 border-b border-border-default p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-feedback-error-bg flex items-center justify-center text-feedback-error-text shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-ink-strong">Гигиена аккаунтов</h2>
              <p className="text-sm text-ink-muted mt-0.5">Сессии выбранного аккаунта и полка проблемных</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {renderTabButton('sessions', 'Активные сессии', <Smartphone className="w-4 h-4" />)}
            {renderTabButton('quarantine', 'Отстойник', <ShieldAlert className="w-4 h-4" />, quarantinedUserbots.length)}
          </div>
        </div>
      </div>

      {activeTab === 'sessions' ? (
        <div className="p-5 sm:p-6 space-y-4 bg-surface-card">
          <p className="text-sm text-ink-muted">
            Залогиненные устройства выбранного аккаунта. Можно выкинуть все, кроме серверной сессии Bullgram.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={loadAuthorizations}
              disabled={authorizationsState.loading || !selectedLiveUserbotId}
              title={!selectedLiveUserbotId ? 'Сначала выбери аккаунт в основном селекторе' : undefined}
            >
              {authorizationsState.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {authorizationsState.loading ? 'Тянем сессии...' : 'Показать сессии'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={resetOtherSessions}
              disabled={resetBusy.others || !selectedLiveUserbotId || !authorizationsState.loaded}
              title={authorizationsState.loaded ? undefined : 'Сначала покажи сессии — увидишь, кого разлогиниваешь'}
            >
              {resetBusy.others ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              {resetBusy.others ? 'Чистим...' : 'Разлогинить остальные'}
            </Button>
          </div>

          {authorizationsState.error ? (
            <div className="rounded-xl border border-border-default bg-feedback-error-bg px-4 py-3 text-sm text-feedback-error-text font-medium">
              {authorizationsState.error}
            </div>
          ) : authorizationsState.loading ? (
            <div className="text-sm text-ink-muted font-medium">Тянем авторизации...</div>
          ) : authorizationsState.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-surface-subtle/40 px-4 py-8 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center text-ink-faint mb-2">
                <Smartphone className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-ink-muted">
                {selectedLiveUserbotId
                  ? 'Нажми «Показать сессии», чтобы загрузить список.'
                  : 'Выбери аккаунт в основном селекторе выше.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2 rounded-xl border border-border-default">
              <table className="w-full">
                <thead className="bg-surface-subtle border-b border-border-default">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-ink-muted uppercase tracking-wider">Устройство</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-ink-muted uppercase tracking-wider">Приложение</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-ink-muted uppercase tracking-wider">Где</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-ink-muted uppercase tracking-wider">Последний движ</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-ink-muted uppercase tracking-wider">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default bg-surface-card">
                  {authorizationsState.rows.map((item) => {
                    const isResetting = resetBusy.hash === item.hash;
                    const canReset = !item.current && !!item.hash;
                    return (
                      <tr key={item.hash || `${item.app_name}-${item.date_active}`} className="hover:bg-surface-subtle transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-ink-strong flex items-center gap-2 flex-wrap">
                            {item.current ? 'Серверная сессия' : (item.device_model || item.platform || 'Устройство')}
                            {item.current ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-feedback-success-bg text-feedback-success-text border border-feedback-success-bg">
                                <span className="w-1.5 h-1.5 rounded-full bg-feedback-success-text mr-1 animate-pulse" />
                                Bullgram
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-ink-muted mt-0.5">
                            {item.current ? 'Текущая серверная сессия' : `${item.platform || ''} ${item.system_version || ''}`.trim()}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-body">{item.app_name || 'Telegram'}</div>
                          <div className="text-xs text-ink-muted">{item.app_version || '—'}{item.official_app ? ' • official' : ''}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-body">{item.country || '—'}</div>
                          <div className="text-xs text-ink-muted font-mono">{item.ip || '—'}{item.region ? ` • ${item.region}` : ''}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-ink-body">{formatDate(item.date_active || item.date_created)}</td>
                        <td className="px-4 py-3 text-right">
                          {item.current ? (
                            <span className="text-xs text-ink-muted font-medium">нельзя</span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg"
                              onClick={() => resetOneSession(item)}
                              disabled={!canReset || isResetting || resetBusy.hash !== ''}
                              title={!canReset ? 'Эту сессию нельзя разлогинить отсюда' : ''}
                            >
                              {isResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                              {isResetting ? '...' : 'Разлогинить'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="p-5 sm:p-6 bg-surface-card">
          {!quarantinedUserbots.length ? (
            <div className="rounded-xl border border-dashed border-border-default bg-surface-subtle/40 px-4 py-8 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center text-ink-faint mb-2">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-ink-muted">Отстойник пуст — все аккаунты рабочие.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <UserbotCombobox
                accounts={quarantinedUserbots}
                value={account ? String(account.id) : ''}
                onValueChange={(value) => setSelectedQuarantinedUserbotId(value)}
                triggerVariant="plain"
                placeholder="Выбрать аккаунт"
                className="w-full sm:w-60 bg-surface-card border-border-default shadow-sm rounded-xl"
              />

              {account ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-surface-subtle border border-border-default">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold text-ink-strong tracking-tight">
                        {account.tg_username ? `@${account.tg_username}` : 'Без username'}
                      </span>
                      <Badge variant="outline" className="bg-surface-card text-ink-muted font-mono text-xs uppercase">
                        ID: {account.tg_account_id}
                      </Badge>
                      {marker ? <StatusBadge tone={isError ? 'error' : 'warning'}>{marker.text}</StatusBadge> : null}
                    </div>
                    <div className="mt-1.5 text-xs text-ink-muted space-y-0.5">
                      {marker?.detail ? <div className="font-medium text-ink-body">{marker.detail}</div> : null}
                      {account.runtime_error ? <div>{account.runtime_error}</div> : null}
                      <div>Проверялся: {formatWhen(account.last_checked_at)}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl shadow-sm"
                      onClick={() => checkAccount(account)}
                      disabled={isChecking}
                    >
                      {isChecking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5 text-ink-muted" />}
                      Проверить Telegram
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl shadow-sm"
                      onClick={openTelegramWeb}
                      title="Открыть Telegram Web этого аккаунта"
                    >
                      <ExternalLink className="w-4 h-4 mr-1.5 text-ink-muted" />
                      Telegram Web
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border-default bg-surface-subtle/40 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-ink-muted">
                    <AlertCircle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                    Выбери аккаунт из списка выше.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
