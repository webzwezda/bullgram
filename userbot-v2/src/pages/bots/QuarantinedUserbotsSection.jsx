import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

// Отстойник: проблемные аккаунты (бан/мёртвая сессия/прокси/упавшая проверка).
// Продажа им закрыта гейтами на бэкенде, здесь — видимая полка, чтобы аккаунты
// не терялись в общем списке и их можно было оживить повторной проверкой.
export function QuarantinedUserbotsSection({
  quarantinedUserbots,
  restrictedMarker,
  formatWhen,
  checkAccount,
  checkingAccountId
}) {
  if (!quarantinedUserbots.length) return null;

  return (
    <Card className="border-0 shadow-lg ring-1 ring-border-default mb-6 bg-surface-card overflow-hidden rounded-2xl">
      <div className="bg-surface-subtle/50 border-b border-border-default p-5 sm:p-6">
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
      </div>

      <div className="p-5 sm:p-6 bg-surface-card space-y-3">
        {quarantinedUserbots.map((account) => {
          const marker = restrictedMarker(account);
          const isChecking = String(account.id) === String(checkingAccountId || '');
          const isError = marker?.className?.includes('danger');
          return (
            <div
              key={String(account.id)}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-surface-subtle border border-border-default"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold text-ink-strong tracking-tight">
                    {account.tg_username ? `@${account.tg_username}` : 'Без username'}
                  </span>
                  {marker ? <StatusBadge tone={isError ? 'error' : 'warning'}>{marker.text}</StatusBadge> : null}
                </div>
                <div className="mt-1 text-xs text-ink-muted space-y-0.5">
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
                {isChecking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5 text-ink-muted" />}
                Проверить Telegram
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
