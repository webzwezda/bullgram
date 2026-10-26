// Оркестрация приёмки пачек аккаунтов (account shop intake, Wave 1).
// Роут POST /intake/batch валидирует запрос и создаёт строку
// account_import_batches, дальше вся работа идёт здесь, fire-and-forget:
//
//   1. под N пачек поднимается ОДИН батч managed-прокси (self_use);
//   2. на каждую пачку — валидация без Telegram (validatePack), вставка
//      tg_accounts в safe-mode (pending_activation) с обязательными
//      зашифрованными blob'ами восстановления (session/json/tdata/2FA);
//   3. прогресс пишется в батч после КАЖДОГО айтема — UI поллит строку батча;
//   4. упавшая пачка освобождает ровно свой прокси и не мешает остальным.
//
// Подключение к Telegram и заполнение health делает отдельная джоба
// (intake-resting.job.js) — приёмка остаётся offline.
import { encrypt } from '../utils/crypto.js';
import { FRESH_IMPORT_RUNTIME_STATUS, FRESH_IMPORT_RUNTIME_REASON } from '../utils/ops-center-selection.js';
import { buildBatchProxyNames, buildManagedProxyPendingMessage } from '../utils/proxy-batch.js';
import { maskPhone, parseTwoFaPassword, validatePack, zipTdataEntries } from './account-pack.service.js';

// Миграция backend/sql/account-shop-intake.sql не применена — айтем откатывается.
export const INTAKE_MISSING_MIGRATION_MESSAGE = 'Сначала примени SQL под account shop intake.';

function isMissingRecoveryTableError(error) {
    const raw = String(error?.message || error || '').toLowerCase();
    // «schema cache» = PostgREST ещё не увидел свежие ALTER'ы (лечится
    // `notify pgrst, 'reload schema'`), миграция при этом стоит — подменять
    // это на «примени SQL» нельзя, скрывает настоящую причину.
    if (raw.includes('schema cache')) return false;
    return raw.includes('userbot_restore_sources') && (
        raw.includes('does not exist')
        || raw.includes('relation')
        || raw.includes('column')
    );
}

export async function processIntakeBatch({
    supabase,
    userbotService,
    managedProxyService,
    ownerId,
    batchId,
    packs = [],
    items = [],
    launchVerification = null,
    deps = {}
}) {
    const nowIso = () => new Date().toISOString();
    const validate = deps.validatePackFn
        || ((pack) => validatePack(pack, userbotService, { extractSession: deps.extractSession }));

    const releasedRecords = new Set();
    const usedRecords = new Set();

    const persistBatch = async (patch) => {
        await supabase
            .from('account_import_batches')
            .update({ ...patch, updated_at: nowIso() })
            .eq('id', batchId);
    };

    const summaryPatch = () => ({
        processed: items.filter((item) => item.status === 'ok').length,
        failed: items.filter((item) => item.status === 'failed').length,
        items
    });

    const releaseProxy = async (proxyId, record) => {
        if (proxyId) {
            const { error: deleteError } = await supabase.from('proxies').delete().eq('id', proxyId).eq('owner_id', ownerId);
            if (deleteError) {
                // Строка прокси жива (кто-то держит ссылку) — слот инвентарю НЕ
                // возвращаем: иначе следующий батч поднимет тот же порт под другой
                // аккаунт и сломает «1 прокси = 1 юзербот».
                console.error('[Intake] proxies row delete failed — slot not released:', {
                    proxyId,
                    error: deleteError.message
                });
                return;
            }
        }
        if (record && !releasedRecords.has(record)) {
            releasedRecords.add(record);
            await managedProxyService.releaseManagedProxyBatch({ records: [record] }).catch(() => {});
        }
    };

    try {
        // 1. Прокси: один батч под всю приёмку. Если подняли, но не вставили —
        // отпускаем обратно в инвентарь, слоты не сжигаем.
        let provisionedRecords = [];
        let proxySlots = [];

        try {
            provisionedRecords = await managedProxyService.provisionManagedProxyBatch({
                count: packs.length,
                inventoryGroup: 'self_use'
            });

            const { data: ownerProxies, error: namesError } = await supabase
                .from('proxies')
                .select('name')
                .eq('owner_id', ownerId);
            if (namesError) throw namesError;

            const names = buildBatchProxyNames('intake', (ownerProxies || []).map((row) => row.name), packs.length);

            const proxyRows = provisionedRecords.map((record, index) => ({
                owner_id: ownerId,
                name: names[index],
                host: record.host,
                port: record.port,
                username: record.username,
                password: record.password,
                is_working: null,
                last_check_error: buildManagedProxyPendingMessage(),
                provision_source: 'manual_admin',
                inventory_group: record.inventory_group
            }));

            const { data: insertedProxies, error: insertError } = await supabase
                .from('proxies')
                .insert(proxyRows)
                .select('id, host, port, username, password');
            if (insertError) throw insertError;

            proxySlots = (insertedProxies || []).map((proxy, index) => ({ proxy, record: provisionedRecords[index] }));
        } catch (proxyError) {
            if (provisionedRecords.length) {
                await managedProxyService.releaseManagedProxyBatch({ records: provisionedRecords }).catch(() => {});
            }
            const message = String(proxyError?.message || proxyError || 'неизвестная ошибка');
            for (const item of items) {
                item.status = 'failed';
                item.error = `Не удалось поднять серверные прокси для приёмки: ${message}`;
            }
            await persistBatch({ status: 'failed', error: `Не удалось поднять серверные прокси для приёмки: ${message}`, ...summaryPatch() });
            return;
        }

        // 2. Пачки обрабатываем последовательно: падение одной не мешает остальным.
        for (let index = 0; index < packs.length; index++) {
            const pack = packs[index];
            const item = items[index] || (items[index] = { key: pack.key, label: pack.label, status: 'queued' });
            const { proxy, record } = proxySlots[index];
            let insertedAccountId = null;

            try {
                const validation = await validate(pack);
                if (!validation.ok) {
                    item.status = 'failed';
                    item.error = validation.error;
                    await releaseProxy(proxy.id, record);
                    await persistBatch(summaryPatch());
                    continue;
                }

                let insertedAccountId = null;
                const { data: accountRow, error: accountError } = await supabase
                    .from('tg_accounts')
                    .insert({
                        owner_id: ownerId,
                        account_type: 'userbot',
                        custom_label: maskPhone(pack.key),
                        session_data: encrypt(userbotService.stringifySessionData(validation.sessionString, validation.fingerprint, 'session_import')),
                        proxy_id: proxy.id,
                        runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                        runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                        allow_proxy_failover: false,
                        failover_proxy_ids: []
                    })
                    .select('id')
                    .single();

                if (accountError || !accountRow?.id) {
                    throw new Error(`Не удалось вставить аккаунт в tg_accounts: ${accountError?.message || 'пустой ответ'}`);
                }
                insertedAccountId = accountRow.id;

                const tdataZipBuffer = pack.tdataEntries.length ? zipTdataEntries(pack.tdataEntries) : null;
                const twoFaSecret = pack.passwordEntry ? parseTwoFaPassword(pack.passwordEntry.buffer) : null;

                try {
                    await userbotService.saveRecoverySource({
                        accountId: accountRow.id,
                        ownerId,
                        tgAccountId: null,
                        sessionFilePath: null,
                        sessionOriginalName: pack.sessionEntry.name,
                        jsonFilePath: null,
                        jsonOriginalName: pack.jsonEntry.name,
                        jsonBuffer: pack.jsonEntry.buffer,
                        fingerprint: validation.fingerprint,
                        sessionBuffer: validation.sessionBuffer,
                        tdataZipBuffer,
                        tdataFilename: tdataZipBuffer ? `${pack.label}-tdata.zip` : null,
                        twoFaSecret,
                        intakeBatchId: batchId
                    });
                } catch (restoreError) {
                    if (isMissingRecoveryTableError(restoreError)) {
                        // Blob'ы восстановления обязательны: без них аккаунт в
                        // системе не живёт — откатываем айтем целиком.
                        await supabase.from('tg_accounts').delete().eq('id', accountRow.id).eq('owner_id', ownerId);
                        await releaseProxy(proxy.id, record);
                        item.status = 'failed';
                        item.error = INTAKE_MISSING_MIGRATION_MESSAGE;
                        await persistBatch(summaryPatch());
                        continue;
                    }
                    throw restoreError;
                }

                if (launchVerification) {
                    launchVerification(proxy);
                }

                item.status = 'ok';
                item.account_id = accountRow.id;
                usedRecords.add(record);
            } catch (itemError) {
                item.status = 'failed';
                item.error = String(itemError?.message || itemError || 'Неизвестная ошибка приёмки.');
                // Аккаунт без обязательных блобов восстановления в системе не живёт
                // (та же логика, что у ветки отсутствующей миграции) — откатываем.
                if (insertedAccountId) {
                    await supabase.from('tg_accounts').delete().eq('id', insertedAccountId).eq('owner_id', ownerId);
                    insertedAccountId = null;
                }
                await releaseProxy(proxy.id, record).catch(() => {});
            }

            // Прогресс — после КАЖДОГО айтема, чтобы UI-поллинг видел движение.
            await persistBatch(summaryPatch());
        }

        // 3. Финал: батч закрыт; страховка — вернуть в инвентарь всё, что
        // не было ни использовано, ни освобождено (например, после исключения).
        const unusedRecords = provisionedRecords.filter((record) =>
            !releasedRecords.has(record) && !usedRecords.has(record));
        if (unusedRecords.length) {
            await managedProxyService.releaseManagedProxyBatch({ records: unusedRecords }).catch(() => {});
        }

        const failedCount = items.filter((item) => item.status === 'failed').length;
        const status = failedCount === items.length && items.length > 0 ? 'failed' : 'completed';
        await persistBatch({ status, ...summaryPatch() });
    } catch (runError) {
        // Общий предохранитель: помечаем батч упавшим и возвращаем прокси.
        const message = String(runError?.message || runError || 'Неизвестная ошибка приёмки.');
        const remaining = [];
        for (let index = 0; index < packs.length; index++) {
            const item = items[index];
            if (item && (item.status === 'ok' || item.status === 'failed')) continue;
            if (item) {
                item.status = 'failed';
                item.error = message;
            }
            const slot = proxySlots[index];
            if (!slot) continue;
            // Строку прокси тоже убираем: с живыми credentials в базе она
            // выглядит как занятый слот с «мертвым» аккаунтом.
            if (slot.proxy?.id) {
                await supabase.from('proxies').delete().eq('id', slot.proxy.id).eq('owner_id', ownerId).catch(() => {});
            }
            if (slot.record && !releasedRecords.has(slot.record)) remaining.push(slot.record);
        }
        if (remaining.length) {
            await managedProxyService.releaseManagedProxyBatch({ records: remaining }).catch(() => {});
        }
        await persistBatch({ status: 'failed', error: message, ...summaryPatch() }).catch(() => {});
    }
}
