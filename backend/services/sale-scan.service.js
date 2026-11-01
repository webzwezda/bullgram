// Скан «Найти аккаунты для продажи» (account sale scan).
// Кнопка на карточке «Продажа аккаунтов» (POST /api/shop/admin/account-lots/scan)
// создаёт строку account_sale_scans и fire-and-forget запускает runSaleScan:
//
//   1. кандидаты — ВСЕ юзерботы админа с restore source (любой runtime_status:
//      online, pending_activation, restricted, frozen, expired, dead_proxy,
//      error — «все места», включая отстойник); сортировка: сначала не
//      проверявшиеся давно;
//   2. по каждому — живая проверка checkStockAccount + applyStockVerdict (тот
//      же код, что у джобы отлёжки приёмки): статусы пишутся честно, с
//      карантинными эффектами (restricted → чистка прокси, unpublish);
//   3. прогресс (processed/failed/items) пишется в строку скана после КАЖДОГО
//      айтема — UI поллит GET /admin/account-lots/scan;
//   4. проверки строго последовательные с анти-флуд паузой
//      USERBOT_INTAKE_RESTING_SLEEP_MS (как в отлёжке), никаких параллельных
//      коннектов; аккаунт без прокси получает вердикт no_proxy без подключения.
//
// Скан ничего не удаляет (кроме карантинных эффектов restricted, как у
// отлёжки), restore source только читает, работает по одному владельцу.
import { applyStockVerdict, checkStockAccount, getIntakeRestingSleepMs, QUARANTINE_STATUSES } from './intake-stock.service.js';

export const SALE_SCAN_MISSING_MIGRATION_MESSAGE = 'Сначала примени SQL под account sale scan.';

// processing-строка, которую не трогали дольше часа — скан умер вместе с
// перезапуском сервера (fire-and-forget): свип помечает его failed.
const SCAN_STALE_AFTER_MS = 60 * 60 * 1000;

export function isMissingScanTableError(error) {
    const code = error?.code || '';
    const message = String(error?.message || error || '');
    return code === '42P01' || message.includes('account_sale_scans');
}

export function isScanStale(row, nowMs = Date.now()) {
    if (!row || row.status !== 'processing') return false;
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    return !updatedAt || (nowMs - updatedAt) > SCAN_STALE_AFTER_MS;
}

export function findActiveScan(rows = []) {
    return rows.find((row) => row?.status === 'processing') || null;
}

// Подпись айтема скана для карточки: custom_label из приёмки, иначе юзернейм,
// иначе tg_account_id/id — админ видит свои же данные, публичная маска не нужна.
export function scanItemLabel(account) {
    return account?.custom_label || account?.tg_username || account?.tg_account_id || String(account?.id || '');
}

// Кандидаты скана по одному владельцу: restore sources админа + их
// tg_accounts (любой статус). orphans — restore sources без строки аккаунта
// (блобы после пуржа): считаются один раз, кандидатами не становятся (v1).
// POST и раннер зовут один хелпер, чтобы выборка не разъехалась.
// Активный лот = draft/published с этим userbot-активом. Скоуп 'listed'
// сканирует именно их, 'unlisted' — всё остальное.
async function loadActiveLotAssetIds(supabase, ownerId) {
    const { data: activeItems, error } = await supabase
        .from('shop_items')
        .select('id')
        .eq('owner_id', ownerId)
        .in('status', ['draft', 'published']);
    if (error) throw error;
    const itemIds = (activeItems || []).map((row) => row.id);
    if (!itemIds.length) return new Set();

    const { data: listedAssets, error: assetsError } = await supabase
        .from('shop_item_assets')
        .select('asset_id')
        .eq('asset_type', 'userbot')
        .in('shop_item_id', itemIds);
    if (assetsError) throw assetsError;
    return new Set((listedAssets || []).map((row) => String(row.asset_id)));
}

export async function loadScanCandidates(supabase, ownerId, scope = 'unlisted') {
    const { data: sources, error: sourcesError } = await supabase
        .from('userbot_restore_sources')
        .select('account_id')
        .eq('owner_id', ownerId);
    if (sourcesError) throw sourcesError;
    const sourceAccountIds = Array.from(new Set((sources || []).map((row) => String(row.account_id))));
    if (!sourceAccountIds.length) return { accounts: [], orphanCount: 0 };

    const { data: accounts, error: accountsError } = await supabase
        .from('tg_accounts')
        .select('id, owner_id, tg_account_id, tg_username, custom_label, runtime_status, session_data, proxy_id, last_checked_at, health_summary')
        .eq('account_type', 'userbot')
        .eq('owner_id', ownerId)
        .in('id', sourceAccountIds)
        .order('last_checked_at', { ascending: true, nullsFirst: true });
    if (accountsError) throw accountsError;

    const rows = accounts || [];
    const foundIds = new Set(rows.map((row) => String(row.id)));
    const activeLotIds = await loadActiveLotAssetIds(supabase, ownerId);

    if (scope === 'listed') {
        // Выставленные — это живые аккаунты с активным лотом; orphan-блобы
        // (источник без аккаунта) к этому скоупу отношения не имеют.
        return { accounts: rows.filter((row) => activeLotIds.has(String(row.id))), orphanCount: 0 };
    }
    const orphanCount = sourceAccountIds.filter((accountId) => !foundIds.has(accountId)).length;
    return { accounts: rows.filter((row) => !activeLotIds.has(String(row.id))), orphanCount };
}

// Свип зависших processing-сканов владельца: старше часа без обновлений —
// failed с честной причиной. Мутирует переданные rows (status/error), чтобы
// вызывающий увидел свежее состояние без перечитывания.
export async function sweepStaleScans(supabase, ownerId, rows = []) {
    const nowMs = Date.now();
    for (const row of rows) {
        if (!isScanStale(row, nowMs)) continue;
        const { error } = await supabase
            .from('account_sale_scans')
            .update({ status: 'failed', error: 'Прерван перезапуском сервера.', updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('owner_id', ownerId)
            .eq('status', 'processing');
        if (error) throw error;
        row.status = 'failed';
        row.error = 'Прерван перезапуском сервера.';
    }
}

// Сам обход. deps: { checkFn, applyVerdictFn, sleepFn } — инъекция для тестов;
// по умолчанию реальная проверка отлёжки + вердикт с eventSource 'sale_scan'.
export async function runSaleScan(supabase, userbotService, { ownerId, scanId, candidates = null, orphanCount: providedOrphans = null, managedProxyService = null, deps = {} } = {}) {
    if (!scanId || !ownerId) {
        throw new Error('runSaleScan: scanId и ownerId обязательны');
    }
    const checkFn = deps.checkFn || checkStockAccount;
    const doSleep = deps.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const applyVerdict = deps.applyVerdictFn
        || ((account, result, checkedAt) => applyStockVerdict(supabase, userbotService, {
            account,
            result,
            checkedAt,
            eventSource: 'sale_scan',
            managedProxyService
        }));

    const persistScan = async (patch) => {
        await supabase
            .from('account_sale_scans')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', scanId)
            .eq('owner_id', ownerId);
    };

    try {
        // Кандидаты приходят из POST (тот же список, по которому посчитан total);
        // перечитывать нельзя — сток мог измениться, total и items разъехались бы.
        const injected = Array.isArray(candidates);
        const { accounts, orphanCount } = injected
            ? { accounts: candidates, orphanCount: providedOrphans ?? 0 }
            : await loadScanCandidates(supabase, ownerId);
        const items = accounts.map((account) => ({
            account_id: account.id,
            label: scanItemLabel(account),
            status: 'queued'
        }));
        let processed = 0;
        let failed = 0;
        const sleepMs = getIntakeRestingSleepMs();

        for (const [index, account] of accounts.entries()) {
            const checkedAt = new Date().toISOString();
            let item;
            try {
                // Тот же набор полей прокси, что у отлёжки: без provision_source/
                // inventory_group ломается форс IPv6-DC (см. checkStockAccount).
                let proxy = null;
                if (account.proxy_id) {
                    const { data: proxyRow, error: proxyError } = await supabase
                        .from('proxies')
                        .select('host, port, username, password, is_working, last_check_ip, provision_source, inventory_group')
                        .eq('id', account.proxy_id)
                        .maybeSingle();
                    if (proxyError) throw proxyError;
                    proxy = proxyRow || null;
                }

                if (!proxy) {
                    // Без прокси подключение невозможно (1 прокси = 1 юзербот) —
                    // вердикт без Telegram-коннекта.
                    item = {
                        account_id: account.id,
                        label: items[index].label,
                        status: 'ok',
                        verdict: 'no_proxy',
                        reason: 'К аккаунту не привязан прокси — проверка сессии невозможна.',
                        checked_at: checkedAt,
                        in_quarantine: false,
                        sellable: false
                    };
                } else {
                    const result = await checkFn(supabase, userbotService, account, proxy);
                    const { verdictStatus } = await applyVerdict(account, result, checkedAt);

                    // Перечитываем строку: вердикт применён с optimistic guard,
                    // sellable/in_quarantine считаем по факту в базе.
                    const { data: freshRow, error: freshError } = await supabase
                        .from('tg_accounts')
                        .select('runtime_status, health_summary')
                        .eq('id', account.id)
                        .maybeSingle();
                    if (freshError) throw freshError;
                    const verdict = String(freshRow?.runtime_status || verdictStatus || account.runtime_status || 'error');
                    const healthStatus = freshRow?.health_summary?.status || null;
                    item = {
                        account_id: account.id,
                        label: items[index].label,
                        status: 'ok',
                        verdict,
                        reason: result.reason || null,
                        checked_at: checkedAt,
                        in_quarantine: QUARANTINE_STATUSES.includes(verdict),
                        sellable: verdict === 'online' || (verdict === 'pending_activation' && healthStatus === 'online')
                    };
                }
            } catch (error) {
                item = {
                    account_id: account.id,
                    label: items[index].label,
                    status: 'failed',
                    verdict: 'error',
                    reason: String(error?.message || error || 'Проверка сессии не прошла.'),
                    checked_at: checkedAt,
                    // Ошибка проверки — не карантин: в базе аккаунт не тронут
                    // (ревью волны: in_quarantine только по факту вердикта).
                    in_quarantine: false,
                    sellable: false
                };
            }

            items[index] = item;
            if (item.status === 'ok') processed += 1;
            else failed += 1;

            // Прогресс после КАЖДОГО айтема — UI видит «Проверяю X из N».
            await persistScan({ processed, failed, items });

            if (index < accounts.length - 1) {
                await doSleep(sleepMs);
            }
        }

        const finalStatus = accounts.length > 0 && failed === accounts.length ? 'failed' : 'completed';
        await persistScan({ status: finalStatus });
        return { status: finalStatus, processed, failed, orphans: orphanCount, items };
    } catch (error) {
        try {
            await persistScan({ status: 'failed', error: String(error?.message || error || 'Скан не прошёл.') });
        } catch (persistError) {
            console.error('[SaleScan] не удалось записать failed-статус скана:', persistError?.message || persistError);
        }
        throw error;
    }
}
