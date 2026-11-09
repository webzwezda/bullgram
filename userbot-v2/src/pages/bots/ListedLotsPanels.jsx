// Вынесено из AccountLotsSection.jsx (механическая разрезка под лимит
// pre-commit 20KB): панель «Уже на витрине» со своим listed-сканом и снятием
// лотов + панель «Проблемные». Тела JSX перенесены дословно; refreshScan —
// это refresh unlisted-скана родителя (removeListedItem перечитывает его
// после снятия лота, как и было в родителе).

import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '../../api/client.js';
import { formatCheckedAgo } from './useAccountLots.js';
import { ruleFailReason, scanVerdictMeta, useSaleScan } from './useSaleScan.js';

export function ListedLotsPanel({ accessToken, showUiMessage, refreshScan }) {
  // Отдельный скан для уже выставленных в магазине: их сессии проверяются
  // независимо от поиска кандидатов — с ростом витрины это разные объёмы.
  const listedScan = useSaleScan({ accessToken, showUiMessage, scope: 'listed' });

  // «Снять» = удалить лот витрины (draft-тупик из ревью P1 исключён): без
  // покупок лот удаляется и аккаунт сразу возвращается в кандидаты; с
  // покупками роут честно откажет (окно выдачи/возврат — вручную).
  const [removingAccountId, setRemovingAccountId] = useState('');
  async function removeListedItem(item) {
    const itemId = item?.listed_item_id;
    if (!itemId || !accessToken || removingAccountId) return;
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
  );
}

export function ProblemItemsPanel({ problemItems, quarantinedCount }) {
  return (
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
  );
}
