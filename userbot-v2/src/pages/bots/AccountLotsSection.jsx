import { AlertCircle, Check, CheckCircle2, Loader2, Store } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  accountLotLabel,
  formatCheckedAgo,
  notReadyMeta,
  useAccountLots
} from './useAccountLots.js';

// Идиомы карточки — как у BatchIntakeSection: плоский icon-box, баннер с
// бордером и feedback-парой, бейджи variant="secondary" парой bg+text.

function StatusBanner({ tone, icon, children }) {
  return (
    <div className="p-4 flex gap-3 items-start rounded-2xl border border-border-default bg-surface-card shadow-sm">
      <span className={`shrink-0 mt-0.5 ${tone}`}>{icon}</span>
      <div className="pt-0.5 text-sm font-medium text-ink-body">{children}</div>
    </div>
  );
}

function pluralizeRu(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const DELIVERY_MODES = [
  {
    value: 'hybrid',
    label: 'Гибрид (по умолчанию)',
    hint: 'Вошедший покупатель получает аккаунт в кабинет и Telegram Web, любой покупатель может скачать архив.'
  },
  {
    value: 'files',
    label: 'Только архив',
    hint: 'Покупатель получает только архив с файлами, аккаунт ему не передаётся.'
  }
];

// Чекбокс на кнопке кита: в ките нет Checkbox-примитива, сырой <input> запрещён.
function RowCheckbox({ checked, disabled, onToggle, label }) {
  return (
    <Button
      type="button"
      variant={checked ? 'default' : 'outline'}
      size="icon"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`h-5 w-5 shrink-0 rounded-md p-0 ${checked ? '' : 'bg-surface-card border-border-default'}`}
    >
      {checked ? <Check className="size-3.5" /> : null}
    </Button>
  );
}

function ResultBadge({ status }) {
  const ok = status === 'ok';
  return (
    <Badge
      variant="secondary"
      className={`text-xs uppercase font-bold py-0.5 px-2 ${
        ok
          ? 'bg-feedback-success-bg text-feedback-success-text'
          : 'bg-feedback-error-bg text-feedback-error-text'
      }`}
    >
      {ok ? 'Выставлен' : 'Ошибка'}
    </Badge>
  );
}

// Партия аккаунтов → продажа: выставить проверенные аккаунты из приёмки на
// витрину пачкой (одна цена → N публичных лотов). Только платформенный админ.
export function AccountLotsSection({
  accessToken,
  accounts,
  reloadAccounts,
  showUiMessage
}) {
  const {
    sellableAccounts,
    notReadyAccounts,
    selectedIds,
    selectedCount,
    toggleSelected,
    clearSelection,
    priceTon,
    setPriceTon,
    title,
    setTitle,
    description,
    setDescription,
    deliveryMode,
    setDeliveryMode,
    isSubmitting,
    results,
    submitError,
    submitBatch
  } = useAccountLots({ accessToken, accounts, reloadAccounts, showUiMessage });

  const createdCount = results.filter((row) => row.status === 'ok').length;

  return (
    <Card className="border-0 shadow-lg ring-1 ring-border-default mb-6 bg-surface-card overflow-hidden rounded-2xl">
      <div className="bg-surface-subtle/50 border-b border-border-default p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-action-primary flex items-center justify-center text-surface-card shrink-0">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-ink-strong">Продажа аккаунтов</h2>
            <p className="text-sm text-ink-muted mt-0.5">
              Отметь проверенные аккаунты из приёмки, назначь одну цену — они встанут на витрину отдельными лотами.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        {submitError ? (
          <StatusBanner tone="text-feedback-error-text" icon={<AlertCircle className="w-5 h-5" />}>
            {submitError}
          </StatusBanner>
        ) : null}

        {!sellableAccounts.length ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 bg-surface-subtle rounded-full flex items-center justify-center mb-3">
              <Store className="w-6 h-6 text-ink-faint" />
            </div>
            <p className="text-sm text-ink-muted font-semibold">Готовых к продаже аккаунтов нет</p>
            <p className="mt-1 text-xs text-ink-muted">
              Импортируй пачку на /connect — после отлёжки и свежей проверки аккаунты появятся здесь.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                  Аккаунты из приёмки
                </span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-body tabular-nums">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Выбрано {selectedCount} из {sellableAccounts.length}
                </span>
              </div>
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {sellableAccounts.map((account) => {
                  const id = String(account.id);
                  const checked = selectedIds.has(id);
                  return (
                    <li key={id} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                      <div className="flex items-center gap-3">
                        <RowCheckbox
                          checked={checked}
                          disabled={isSubmitting}
                          onToggle={() => toggleSelected(id)}
                          label={`Выбрать ${accountLotLabel(account)}`}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-body">
                          {accountLotLabel(account)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                          <span className="w-2 h-2 rounded-full bg-feedback-success-text shrink-0" />
                          Проверен {formatCheckedAgo(account.last_checked_at)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {notReadyAccounts.length ? (
              <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4 opacity-80">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                    Не готов к продаже
                  </span>
                  <span className="text-sm font-semibold text-ink-muted tabular-nums">
                    {notReadyAccounts.length}
                  </span>
                </div>
                <ul className="max-h-60 space-y-1.5 overflow-y-auto">
                  {notReadyAccounts.map((account) => {
                    const meta = notReadyMeta(account);
                    return (
                      <li key={String(account.id)} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                        <div className="flex items-center gap-3">
                          <RowCheckbox
                            checked={false}
                            disabled
                            onToggle={() => {}}
                            label={`${accountLotLabel(account)} — не готов к продаже`}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-muted">
                            {accountLotLabel(account)}
                          </span>
                          <span className={`flex shrink-0 items-center gap-1.5 text-xs ${meta.textClass}`}>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
                            {meta.reason}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="account-lot-price" className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                  Цена лота, TON — одна на всех выбранных
                </label>
                <Input
                  id="account-lot-price"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Например 12"
                  className="h-11 bg-surface-subtle tabular-nums"
                  value={priceTon}
                  onChange={(event) => setPriceTon(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="account-lot-title" className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                  Название лота
                </label>
                <Input
                  id="account-lot-title"
                  type="text"
                  placeholder="Telegram-аккаунт"
                  className="h-11 bg-surface-subtle"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="account-lot-description" className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                  Описание (необязательно)
                </label>
                <Input
                  id="account-lot-description"
                  type="text"
                  placeholder="Что получит покупатель"
                  className="h-11 bg-surface-subtle"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                Как покупатель получает аккаунт
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                {DELIVERY_MODES.map((mode) => {
                  const active = deliveryMode === mode.value;
                  return (
                    <Button
                      key={mode.value}
                      type="button"
                      variant="outline"
                      aria-pressed={active}
                      onClick={() => setDeliveryMode(mode.value)}
                      disabled={isSubmitting}
                      className={`h-auto flex-col items-start gap-1 rounded-2xl border p-4 text-left ${
                        active
                          ? 'border-action-primary bg-surface-subtle'
                          : 'border-border-default bg-surface-card'
                      }`}
                    >
                      <span className={`text-sm font-bold ${active ? 'text-ink-strong' : 'text-ink-body'}`}>
                        {mode.label}
                      </span>
                      <span className="text-xs font-normal text-ink-muted">{mode.hint}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submitBatch} disabled={isSubmitting || !selectedCount}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Выставляю...
                  </>
                ) : (
                  <>
                    <Store className="w-4 h-4 mr-2" />
                    Выставить {selectedCount} {pluralizeRu(selectedCount, 'аккаунт', 'аккаунта', 'аккаунтов')}
                  </>
                )}
              </Button>
              {selectedCount ? (
                <Button variant="ghost" onClick={clearSelection} disabled={isSubmitting}>
                  Снять выделение
                </Button>
              ) : null}
            </div>
          </>
        )}

        {results.length ? (
          <div className="space-y-4">
            {createdCount > 0 ? (
              <StatusBanner tone="text-feedback-success-text" icon={<CheckCircle2 className="w-5 h-5" />}>
                Выставлено {createdCount} из {results.length}. Лоты видны на bullgram.xyz/shop.
              </StatusBanner>
            ) : (
              <StatusBanner tone="text-feedback-error-text" icon={<AlertCircle className="w-5 h-5" />}>
                Ни один лот не выставился — бэкенд вернул ошибки по каждому аккаунту.
              </StatusBanner>
            )}

            <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4">
              <div className="mb-3 text-xs uppercase tracking-widest font-semibold text-ink-muted">
                Результат публикации
              </div>
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {results.map((row) => (
                  <li key={row.asset_id} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-body">
                        {row.label}
                      </span>
                      <ResultBadge status={row.status} />
                    </div>
                    {row.status !== 'ok' && row.error ? (
                      <div className="mt-1 text-xs text-ink-muted">{row.error}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
