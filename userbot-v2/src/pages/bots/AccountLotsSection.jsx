import {
  AlertCircle, Archive, Check, CheckCircle2, Loader2, ScanSearch, Store
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatCheckedAgo, useAccountLots } from './useAccountLots.js';
import { useSaleScan } from './useSaleScan.js';
import { ListedLotsPanel, ProblemItemsPanel } from './ListedLotsPanels.jsx';

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

// Партия аккаунтов → продажа: кнопка запускает живой скан сессий по всем
// хранилищам, из его результатов админ выбирает живые и выставляет на витрину
// пачкой (одна цена → N публичных лотов). Только платформенный админ.
export function AccountLotsSection({ accessToken, showUiMessage }) {
  const {
    scan,
    isScanning,
    isStarting,
    stale,
    error: scanError,
    startScan,
    refreshScan,
    removeScanItem
  } = useSaleScan({ accessToken, showUiMessage, scope: 'unlisted' });

  // Только что выставленные: скан-снапшот всё ещё содержит их как sellable —
  // прячем локально до следующего скана (бэкенд-гейт и так не даст продать дважды).
  const [locallyListedIds, setLocallyListedIds] = useState(() => new Set());

  const scanItems = useMemo(() => (Array.isArray(scan?.items) ? scan.items : []), [scan]);
  // Группы результатов — только у завершённого скана: пока скан идёт, айтемы
  // дописываются порциями (queued-строки без вердикта) и рано показывать их.
  const isScanCompleted = Boolean(scan) && scan.status !== 'processing';
  // Уже выставленные (есть активный лот) уезжают из «Живых» — иначе после
  // выставления карточка вечно предлагала продать то, что уже на витрине.
  const sellableItems = useMemo(
    () => (isScanCompleted ? scanItems.filter((item) => (
      item?.sellable === true
      && item?.listed !== true
      && !locallyListedIds.has(String(item.account_id))
    )) : []),
    [isScanCompleted, scanItems, locallyListedIds]
  );
  const problemItems = useMemo(
    () => (isScanCompleted ? scanItems.filter((item) => item?.sellable !== true) : []),
    [isScanCompleted, scanItems]
  );
  const quarantinedCount = useMemo(
    () => problemItems.filter((item) => item?.in_quarantine === true).length,
    [problemItems]
  );
  const orphansCount = isScanCompleted ? Number(scan?.orphans || 0) : 0;

  const {
    selectedIds,
    selectedCount,
    toggleSelected,
    clearSelection,
    priceTon,
    setPriceTon,
    isSubmitting,
    results,
    submitError,
    submitBatch
  } = useAccountLots({ accessToken, items: sellableItems, showUiMessage });

  const createdCount = results.filter((row) => row.status === 'ok').length;

  // После выставления перечитываем скан: backend проставит listed,
  // и живые уедут в «Уже на витрине».
  async function submitAndRefresh() {
    await submitBatch();
    setLocallyListedIds((prev) => {
      const next = new Set(prev);
      for (const row of results) {
        if (row.status === 'ok') next.add(String(row.asset_id));
      }
      return next;
    });
    await refreshScan();
  }

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
              Единственное место продажи аккаунтов: скан живых сессий, витрина и снятие лотов — всё здесь.
              Продать можно только аккаунт с tdata-архивом, свежей проверкой и отлёжкой.
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

        {scanError ? (
          <StatusBanner tone="text-feedback-error-text" icon={<AlertCircle className="w-5 h-5" />}>
            {scanError}
          </StatusBanner>
        ) : null}

        {scan?.status === 'failed' && scan.error && scan.error !== scanError ? (
          <StatusBanner tone="text-feedback-error-text" icon={<AlertCircle className="w-5 h-5" />}>
            {scan.error}
          </StatusBanner>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={startScan} disabled={isScanning || isStarting}>
              {isScanning || isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isStarting
                    ? 'Запускаю...'
                    : `Проверяю ${Number(scan?.processed || 0)} из ${Number(scan?.total || 0)}`}
                </>
              ) : (
                <>
                  <ScanSearch className="w-4 h-4 mr-2" />
                  Найти аккаунты для продажи
                </>
              )}
            </Button>
            {isScanning ? (
              <span className="text-xs text-ink-muted">Живая проверка: ~30–60 сек на аккаунт</span>
            ) : null}
          </div>

          {!scan ? (
            <div className="p-8 text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 bg-surface-subtle rounded-full flex items-center justify-center mb-3">
                <Store className="w-6 h-6 text-ink-faint" />
              </div>
              <p className="text-sm text-ink-muted font-semibold">
                Нажми «Найти аккаунты» — проверю сессии во всех хранилищах: боевые, safe-mode, отстойник.
              </p>
              <p className="mt-1 text-xs text-ink-muted">Живая проверка: ~30–60 сек на аккаунт</p>
            </div>
          ) : null}
        </div>

        {isScanCompleted && !scanItems.length && !orphansCount ? (
          <p className="text-sm text-ink-muted">
            Скан ничего не нашёл — импортируй пачку карточкой выше и прогони скан заново.
          </p>
        ) : null}

        {stale ? (
          <div>
            <Badge
              variant="secondary"
              className="bg-feedback-warning-bg text-feedback-warning-text text-xs font-bold py-0.5 px-2"
            >
              Проверка устарела — прогони скан заново
            </Badge>
          </div>
        ) : null}

        {sellableItems.length ? (
          <>
            <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                  Живые — можно выставлять
                </span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-body tabular-nums">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Выбрано {selectedCount} из {sellableItems.length}
                </span>
              </div>
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {sellableItems.map((item) => {
                  const id = String(item.account_id);
                  const checked = selectedIds.has(id);
                  return (
                    <li key={id} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                      <div className="flex items-center gap-3">
                        <RowCheckbox
                          checked={checked}
                          disabled={isSubmitting}
                          onToggle={() => toggleSelected(id)}
                          label={`Выбрать ${item.label || id}`}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-body">
                          {item.label || id}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                          <span className="w-2 h-2 rounded-full bg-feedback-success-text shrink-0" />
                          Проверен {formatCheckedAgo(item.checked_at)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>


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
            </div>

            <p className="text-xs font-medium text-ink-muted">
              Название лота сгенерируется само — страна по номеру и срок отлёжки. Анонимный покупатель
              получит архив с файлами; вошедший под логином — ещё и аккаунт в кабинет с Telegram Web.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submitAndRefresh} disabled={isSubmitting || !selectedCount}>
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
        ) : null}

        <ListedLotsPanel
          accessToken={accessToken}
          showUiMessage={showUiMessage}
          refreshScan={refreshScan}
        />

        {problemItems.length ? (
          <ProblemItemsPanel problemItems={problemItems} quarantinedCount={quarantinedCount} />
        ) : null}

        {orphansCount > 0 ? (
          <div className="flex items-start gap-2.5 rounded-2xl border border-border-default bg-surface-subtle/50 px-4 py-3 text-xs text-ink-muted">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
            <span>
              Архивов без аккаунта: {orphansCount} — восстановить можно через Restore в кабинете.
            </span>
          </div>
        ) : null}

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
