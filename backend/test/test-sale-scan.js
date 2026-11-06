/**
 * Юнит-тесты скана «Найти аккаунты для продажи» (account sale scan).
 * Офлайн, детерминированные: мок supabase в стиле test-account-intake.js
 * (select-projection, eq/neq/in/not/order-нооп, insert/update/delete), Telegram
 * не трогаем — проверка инъекцией checkFn, вердикт применяется РЕАЛЬНЫМ кодом
 * applyStockVerdict (intake-stock.service.js, тем же, что у джобы отлёжки) с
 * моком ManagedProxyService.
 *
 * Покрывает: loadScanCandidates (все статусы: online/safe-mode/restricted/
 * frozen + рабочие QR-импорты БЕЗ restore source (has_tdata=false, не orphan)
 * + orphan без аккаунта + чужие владельцы исключаются), runSaleScan (прогресс
 * после каждого айтема; no_proxy без check-вызова; restricted применяет
 * карантинные эффекты с event_source 'sale_scan' и чистит прокси; sellable-
 * флаги по полному правилу владельца: tdata + отлёжка; completed; всё упало →
 * failed), правило продажи accountSaleRuleState (tdata/отлёжка/свежесть/
 * граница 48ч), attachListedItemIds (public-лот → listed_item_id, draft →
 * null), isScanStale / findActiveScan / sweepStaleScans, isMissingScanTableError.
 *
 * Разрезка под лимит pre-commit (20КБ): хост остался на исходном пути и
 * запускает сценарии из test/sale-scan/ в исходном порядке; общие фикстуры —
 * test/sale-scan/shared.js. Порядок проверок и сообщения — как в оригинале.
 */
import { failureCount } from './sale-scan/shared.js';
import { runLoadCandidatesStatuses } from './sale-scan/load-candidates-statuses.js';
import { runAccountSaleRuleState } from './sale-scan/account-sale-rule-state.js';
import { runScanItemLabel } from './sale-scan/scan-item-label.js';
import { runScanProgressCompleted } from './sale-scan/run-scan-progress-completed.js';
import { runScanRecoveredOnline } from './sale-scan/run-scan-recovered-online.js';
import { runScanRuleReasons } from './sale-scan/run-scan-rule-reasons.js';
import { runAttachListedItemIds } from './sale-scan/attach-listed-item-ids.js';
import { runScanRestrictedQuarantine } from './sale-scan/run-scan-restricted-quarantine.js';
import { runScanAllFailed } from './sale-scan/run-scan-all-failed.js';
import { runScanStaleSweep } from './sale-scan/scan-stale-sweep.js';
import { runMissingScanTableError } from './sale-scan/missing-scan-table-error.js';
import { runLoadCandidatesScopes } from './sale-scan/load-candidates-scopes.js';
import { runScanQrReportOnly } from './sale-scan/run-scan-qr-report-only.js';

await runLoadCandidatesStatuses();
await runAccountSaleRuleState();
await runScanItemLabel();
await runScanProgressCompleted();
await runScanRecoveredOnline();
await runScanRuleReasons();
await runAttachListedItemIds();
await runScanRestrictedQuarantine();
await runScanAllFailed();
await runScanStaleSweep();
await runMissingScanTableError();

console.log(failureCount() === 0 ? '\nВсе проверки скана продажи прошли' : `\nПровалено проверок: ${failureCount()}`);

await runLoadCandidatesScopes();
await runScanQrReportOnly();

process.exit(failureCount() === 0 ? 0 : 1);
