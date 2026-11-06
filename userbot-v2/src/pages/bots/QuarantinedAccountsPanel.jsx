import {
  AlertCircle, ExternalLink, Loader2, RefreshCw, ShieldAlert, Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserbotCombobox } from '@/components/bots/UserbotCombobox';

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

export function QuarantinedAccountsPanel({
  quarantinedUserbots,
  selectedQuarantinedUserbot,
  setSelectedQuarantinedUserbotId,
  restrictedMarker,
  formatWhen,
  checkAccount,
  checkingAccountId,
  deleteAccount,
  deletingAccountId
}) {
  function openTelegramWeb() {
    if (!selectedQuarantinedUserbot?.id) return;
    window.open(`/userbot/telegram-web/${selectedQuarantinedUserbot.id}`, '_blank', 'noopener');
  }

  const account = selectedQuarantinedUserbot;
  const marker = account ? restrictedMarker(account) : null;
  const isChecking = account && String(account.id) === String(checkingAccountId || '');
  const isDeleting = account && String(account.id) === String(deletingAccountId || '');
  const isError = marker?.className?.includes('danger');

  // Удаление только аккаунта: DELETE /api/userbot/:id не трогает прокси —
  // он остаётся в инвентаре и может быть перепривязан.
  function deleteQuarantinedAccount() {
    const label = account?.tg_username ? `@${account.tg_username}` : `ID ${account?.tg_account_id}`;
    deleteAccount(account, {
      confirmMessage: `Удалить аккаунт ${label} из отстойника? Сессия удалится безвозвратно. Прокси останется в инвентаре — его можно привязать к другому аккаунту.`
    });
  }

  return (
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
                  disabled={isChecking || isDeleting}
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
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-xl"
                  onClick={deleteQuarantinedAccount}
                  disabled={isChecking || isDeleting}
                  title="Удалить аккаунт; прокси останется в инвентаре"
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}
                  {isDeleting ? 'Удаляем...' : 'Удалить аккаунт'}
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
  );
}
