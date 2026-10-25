import { BadgeCheck, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
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

// Отстойник: проблемные аккаунты (заморозка/бан/мёртвая сессия/прокси/упавшая
// проверка). Из основного селектора они убраны — живут только здесь; продажа
// закрыта гейтами на бэкенде. Оживить можно живой проверкой.
export function QuarantinedUserbotsSection({
  quarantinedUserbots,
  selectedQuarantinedUserbot,
  setSelectedQuarantinedUserbotId,
  restrictedMarker,
  formatWhen,
  checkAccount,
  checkingAccountId
}) {
  if (!quarantinedUserbots.length) return null;

  const account = selectedQuarantinedUserbot;
  const marker = account ? restrictedMarker(account) : null;
  const isChecking = account && String(account.id) === String(checkingAccountId || '');
  const isError = marker?.className?.includes('danger');

  return (
    <Card className="border-0 shadow-lg ring-1 ring-border-default mb-6 bg-surface-card overflow-hidden rounded-2xl">
      <div className="bg-surface-subtle/50 border-b border-border-default p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-feedback-error-bg flex items-center justify-center text-feedback-error-text shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-ink-strong flex items-center gap-2">
                Отстойник
                <Badge variant="secondary" className="bg-feedback-error-bg text-feedback-error-text hover:bg-feedback-error-bg border-0 text-xs rounded-full px-2">
                  {quarantinedUserbots.length}
                </Badge>
              </h2>
              <p className="text-sm text-ink-muted mt-0.5">Проблемные аккаунты: в продажу не идут, пока не пройдут живую проверку</p>
            </div>
          </div>

          {quarantinedUserbots.length > 0 && (
            <UserbotCombobox
              accounts={quarantinedUserbots}
              value={account ? String(account.id) : ''}
              onValueChange={(value) => setSelectedQuarantinedUserbotId(value)}
              triggerVariant="plain"
              placeholder="Выбрать аккаунт"
              className="w-full sm:w-60 bg-surface-card border-border-default shadow-sm rounded-xl"
            />
          )}
        </div>
      </div>

      {!account ? (
        <div className="p-12 text-center flex flex-col items-center justify-center bg-surface-card">
          <div className="w-16 h-16 bg-surface-subtle rounded-full flex items-center justify-center mb-4 ring-1 ring-border-default">
            <ShieldAlert className="w-8 h-8 text-ink-faint" />
          </div>
          <h3 className="text-base font-semibold text-ink-strong">Выбери аккаунт</h3>
          <p className="mt-1 text-sm text-ink-muted max-w-sm">Выбери проблемный аккаунт из списка выше, чтобы посмотреть причину.</p>
        </div>
      ) : (
        <div className="p-5 sm:p-6 bg-surface-card">
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
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 rounded-xl shadow-sm"
              onClick={() => checkAccount(account)}
              disabled={isChecking}
            >
              {isChecking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <BadgeCheck className="w-4 h-4 mr-1.5 text-ink-muted" />}
              Проверить Telegram
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
