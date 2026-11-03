import {
  AlertCircle, Archive, Check, CheckCircle2, Loader2, ScanSearch, ShieldAlert, ShieldCheck, Store
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { apiRequest } from '../../api/client.js';
import { formatCheckedAgo, useAccountLots } from './useAccountLots.js';
import { ruleFailReason, scanVerdictMeta, useSaleScan } from './useSaleScan.js';

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

  // Отдельный скан для уже выставленных в магазине: их сессии проверяются
  // независимо от поиска кандидатов — с ростом витрины это разные объёмы.
  const listedScan = useSaleScan({ accessToken, showUiMessage, scope: 'listed' });

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

  // «Снять» = удалить лот витрины (draft-тупик из ревью P1 исключён): без
  // покупок лот удаляется и аккаунт сразу возвращается в кандидаты; с
  // покупками роут честно откажет (окно выдачи/возврат — вручную).
  const [removingAccountId, setRemovingAccountId] = useState('');
  async function removeListedItem(item) {
    const itemId = item?.listed_item_id;
    if (!itemId || !accessToken || removingAccountId) return;
    const label = item.label || 'аккаунт';
    if (!window.confirm(`Удалить лот «${label}» с витрины? Аккаунт вернётся в список кандидатов.`)) return;
    setRemovingAccountId(String(item.account_id || ''));
    try {
      await apiRequest(`/api/shop/admin/items/${itemId}`, {
        accessToken,
        method: 'DELETE'
      });
      listedScan.removeScanItem(String(item.account_id));
      showUiMessage('Лот удалён — аккаунт снова в списке кандидатов.', 'success');
      await refreshScan();
    } catch (error) {
      showUiMessage(error.message || 'Не удалось удалить лот с витрины.', 'error');
    } finally {
      setRemovingAccountId('');
    }
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

            <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                  Уже на витрине
                </span>
                <Button
                  variant="outline"
                  onClick={listedScan.startScan}
                  disabled={listedScan.isScanning || listedScan.isStarting}
                >
                  {listedScan.isScanning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Проверяю {Number(listedScan.scan?.processed || 0)} из {Number(listedScan.scan?.total || 0)}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 mr-2" />
                      Проверить выставленные
                    </>
                  )}
                </Button>
              </div>

              {listedScan.error ? (
                <p className="text-sm font-medium text-feedback-error-text">{listedScan.error}</p>
              ) : null}

              {listedScan.stale ? (
                <div className="mb-2">
                  <Badge
                    variant="secondary"
                    className="bg-feedback-warning-bg text-feedback-warning-text text-xs font-bold py-0.5 px-2"
                  >
                    Проверка устарела — прогони скан заново
                  </Badge>
                </div>
              ) : null}

              {(() => {
                // Только строки с публичным лотом (listed_item_id от GET-скана):
                // снятые/проданные лоты исчезают отсюда сразу после refreshScan,
                // без нового скана.
                const items = (Array.isArray(listedScan.scan?.items) ? listedScan.scan.items : [])
                  .filter((item) => item?.listed_item_id);
                if (!items.length) {
                  return (
                    <p className="text-xs font-medium text-ink-muted">
                      Живая проверка сессий у всех лотов витрины: замороженные и ограниченные сразу
                      увидишь здесь. Проверка идёт по ~30–60 сек на аккаунт.
                    </p>
                  );
                }
                return (
                  <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                    {items.map((item) => {
                      const meta = scanVerdictMeta(item);
                      const healthy = item.verdict === 'online' || item.verdict === 'pending_activation';
                      const isRemoving = removingAccountId === String(item.account_id);
                      return (
                        <li key={String(item.account_id)} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                          <div className="flex items-center gap-3">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-body">
                              {item.label || item.account_id}
                            </span>
                            <span className={`flex shrink-0 items-center gap-1.5 text-xs ${meta.textClass}`}>
                              <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
                              {healthy
                                ? `Проверен ${formatCheckedAgo(item.checked_at)}`
                                : meta.label}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 h-7 px-2 text-xs"
                              disabled={Boolean(removingAccountId)}
                              onClick={() => removeListedItem(item)}
                            >
                              {isRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Снять'}
                            </Button>
                          </div>
                          {!healthy && item.reason ? (
                            <div className="mt-1 text-xs text-ink-muted">{item.reason}</div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>

        {problemItems.length ? (
          <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4 opacity-80">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                Проблемные
              </span>
              <span className="text-sm font-semibold text-ink-muted tabular-nums">
                {problemItems.length}
              </span>
            </div>
            <ul className="max-h-60 space-y-1.5 overflow-y-auto">
              {problemItems.map((item, index) => {
                const meta = scanVerdictMeta(item);
                // Правило продажи не пройдено при живом вердикте: причина
                // правила («Нет tdata-архива» / «Отлёжка…») — главный текст,
                // вердикт-подпись глушим. Старые сканы без rule-полей рендерим
                // как раньше (treat as ok).
                const ruleReason = ruleFailReason(item);
                return (
                  <li
                    key={item.account_id || `${item.label}-${index}`}
                    className="rounded-lg border border-border-default bg-surface-card px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-muted">
                        {item.label || item.account_id}
                      </span>
                      <span className={`flex shrink-0 items-center gap-1.5 text-xs ${ruleReason ? 'text-ink-muted' : meta.textClass}`}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${ruleReason ? 'bg-ink-faint' : meta.dotClass}`} />
                        {ruleReason || meta.label}
                      </span>
                    </div>
                    {!ruleReason && item.reason ? (
                      <div className="mt-1 text-xs text-ink-muted">{item.reason}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {quarantinedCount ? (
              <div className="mt-3 flex items-start gap-2.5 text-xs text-ink-muted">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-feedback-error-text" aria-hidden="true" />
                <span>Карантинные лежат в отстойнике — Гигиена аккаунтов на /userbot.</span>
              </div>
            ) : null}
          </div>
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
