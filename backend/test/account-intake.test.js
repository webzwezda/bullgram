/**
 * Юнит-тесты приёмки пачек аккаунтов (account shop intake, Wave 1).
 * Офлайн, детерминированные: группировка пачек и распаковка zip — на реальном
 * adm-zip; 2FA-пароли — utf8 и CP1251 (ручной энкодер в тесте); validatePack —
 * на реальных методах userbot.service (extractSession инъекцией, без sqlite);
 * processIntakeBatch и job отстоя runIntakeRestingCheck — на моке supabase в
 * стиле test-shop-quarantine.js, Telegram не трогаем.
 *
 * Покрывает: teleak-style zip (tdata + json + session + CP1251-заметка),
 * multi-pack zip, .session без .json → reject, tdata по scope, вложенный zip,
 * zip-bomb гард, parseTwoFaPassword (utf8/CP1251/без пароля/слишком длинный),
 * validatePack (ок/битый sqlite/битый json), processIntakeBatch (ок-путь с
 * safe-mode + recovery + прогресс; упавшая пачка освобождает ровно свой прокси;
 * missing restore table → откат айтема; упавший insert прокси), отсюда же
 * runIntakeRestingCheck (online сохраняет pending_activation и пишет identity +
 * health_summary; restricted → событие + чистка прокси; frozen → событие без
 * чистки; expired; дубликат; свежая проверка не повторяется).
 *
 * Разрезка под лимит pre-commit (20КБ): хост остался на исходном пути и
 * запускает сценарии из test/account-intake/ в исходном порядке; общие
 * фикстуры — test/account-intake/shared.js. Порядок проверок и сообщения —
 * как в оригинале.
 */
import { failureCount } from './account-intake/shared.js';
import { runGroupPacksTeleakZip } from './account-intake/group-packs-teleak-zip.js';
import { runGroupPacksMultipack } from './account-intake/group-packs-multipack.js';
import { runGroupPacksIncomplete } from './account-intake/group-packs-incomplete.js';
import { runUnpackZipGuards } from './account-intake/unpack-zip-guards.js';
import { runParseTwoFaPassword } from './account-intake/parse-two-fa-password.js';
import { runZipTdataEntries } from './account-intake/zip-tdata-entries.js';
import { runValidatePack } from './account-intake/validate-pack.js';
import { runProcessIntakeOk } from './account-intake/process-intake-ok.js';
import { runProcessIntakeFailedPack } from './account-intake/process-intake-failed-pack.js';
import { runProcessIntakeMissingRestoreTable } from './account-intake/process-intake-missing-restore-table.js';
import { runProcessIntakeProxyInsertFails } from './account-intake/process-intake-proxy-insert-fails.js';
import { runRestingOnlineIdentity } from './account-intake/resting-online-identity.js';
import { runRestingProductionStock } from './account-intake/resting-production-stock.js';
import { runRestingRestrictedFrozenExpiredDuplicate } from './account-intake/resting-restricted-frozen-expired-duplicate.js';
import { runRestingFreshAndNonAdmin } from './account-intake/resting-fresh-and-non-admin.js';
import { runRestingHealableVerdicts } from './account-intake/resting-healable-verdicts.js';

await runGroupPacksTeleakZip();
await runGroupPacksMultipack();
await runGroupPacksIncomplete();
await runUnpackZipGuards();
await runParseTwoFaPassword();
await runZipTdataEntries();
await runValidatePack();
await runProcessIntakeOk();
await runProcessIntakeFailedPack();
await runProcessIntakeMissingRestoreTable();
await runProcessIntakeProxyInsertFails();
await runRestingOnlineIdentity();
await runRestingProductionStock();
await runRestingRestrictedFrozenExpiredDuplicate();
await runRestingFreshAndNonAdmin();
await runRestingHealableVerdicts();

console.log(failureCount() === 0 ? '\nВсе проверки приёмки пачек прошли' : `\nПровалено проверок: ${failureCount()}`);
process.exit(failureCount() === 0 ? 0 : 1);
