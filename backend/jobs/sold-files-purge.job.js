// Пурж проданных «в файлы» аккаунтов (account shop delivery, Wave 2).
// Младший брат restricted-userbot-cleanup: после оплаты files-покупки (или
// hybrid у анонимного покупателя) наша копия аккаунта нужна только как
// источник архива на время окна выдачи. Когда окно истекло — удаляем
// restore source, tg_account и его managed-прокси (освобождаем слот 3proxy)
// и ставим payload.delivery.purged_at.
//
// Гибридные покупки с передачей покупателю НЕ пуржатся никогда: аккаунт уже
// принадлежит покупателю, а архив — его данные (качается бессрочно).
// Возвраты (ownership_transfer_status='failed') не трогаем — решаются вручную.
import { cleanupRestrictedUserbotProxy } from '../utils/restricted-userbot-ops.js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';
import { getShopFilesWindowHours } from '../utils/shop-files.js';

const DEFAULT_INTERVAL_MS = 3_600_000;
const MIN_INTERVAL_MS = 300_000;

function soldFilesPurgeEnabled() {
    return String(process.env.USERBOT_SOLD_FILES_PURGE_ENABLED || '').trim().toLowerCase() !== 'false';
}

function getIntervalMs() {
    const raw = Number(process.env.USERBOT_SOLD_FILES_PURGE_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < MIN_INTERVAL_MS) {
        return DEFAULT_INTERVAL_MS;
    }
    return raw;
}

export async function runSoldFilesPurge(supabase, { managedProxyService = null } = {}) {
    const windowHours = getShopFilesWindowHours();
    const cutoffIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

    const { data: purchases, error } = await supabase
        .from('shop_purchases')
        .select('id, shop_item_id, seller_owner_id, buyer_owner_id, ownership_transfer_status, delivered_at, payload')
        .eq('status', 'paid')
        .not('delivered_at', 'is', null)
        .lt('delivered_at', cutoffIso)
        .eq('payload->delivery->>mode', 'files')
        .is('payload->delivery->>purged_at', null);
    if (error) throw error;

    if (!(purchases || []).length) return;

    const proxyService = managedProxyService || new ManagedProxyService();
    console.log('[SoldFilesPurge] run', { candidates: purchases.length, window_hours: windowHours });

    for (const purchase of purchases) {
        try {
            if (purchase.buyer_owner_id || String(purchase.ownership_transfer_status || '') === 'completed') {
                console.warn('[SoldFilesPurge] skip: покупка с покупателем или передачей прав', {
                    purchase_id: purchase.id
                });
                continue;
            }

            const { data: assets, error: assetsError } = await supabase
                .from('shop_item_assets')
                .select('asset_id')
                .eq('shop_item_id', purchase.shop_item_id)
                .eq('asset_type', 'userbot');
            if (assetsError) throw assetsError;

            const accountId = assets?.[0]?.asset_id || null;
            if (!accountId) {
                console.warn('[SoldFilesPurge] skip: у лота нет userbot-актива', {
                    purchase_id: purchase.id
                });
                continue;
            }

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, proxy_id')
                .eq('id', accountId)
                .maybeSingle();
            if (accountError) throw accountError;
            if (!account) {
                console.warn('[SoldFilesPurge] skip: аккаунт уже удалён', {
                    purchase_id: purchase.id,
                    account_id: accountId
                });
                continue;
            }

            // Порядок важен (см. ревью): прокси открепляем ПЕРЕД удалением
            // аккаунта — гейт «прокси общий» в cleanupRestrictedUserbotProxy
            // считает живые ссылки, и после удаления он бы увидел единственную.
            // Restore source удаляем последним: пока аккаунт жив, у оплаченного
            // покупателя не должен отвалиться линк на скачивание из-за сбоя
            // на середине пуржа.
            const proxyCleanup = await cleanupRestrictedUserbotProxy(supabase, proxyService, purchase.seller_owner_id, account);

            const { error: accountDeleteError } = await supabase
                .from('tg_accounts')
                .delete()
                .eq('id', accountId)
                .eq('owner_id', purchase.seller_owner_id);
            if (accountDeleteError) throw accountDeleteError;

            const { error: sourceDeleteError } = await supabase
                .from('userbot_restore_sources')
                .delete()
                .eq('account_id', accountId);
            if (sourceDeleteError && !String(sourceDeleteError.message || '').includes('userbot_restore_sources')) {
                throw sourceDeleteError;
            }

            const purgedAt = new Date().toISOString();
            const { error: patchError } = await supabase
                .from('shop_purchases')
                .update({
                    payload: { ...(purchase.payload || {}), delivery: { ...(purchase.payload?.delivery || {}), purged_at: purgedAt } },
                    updated_at: purgedAt
                })
                .eq('id', purchase.id);
            if (patchError) throw patchError;

            console.log('[SoldFilesPurge] purged', {
                purchase_id: purchase.id,
                account_id: accountId,
                proxy_cleanup: proxyCleanup
            });
        } catch (error) {
            console.error('[SoldFilesPurge] purchase purge failed:', {
                purchase_id: purchase.id,
                error: error?.message || error
            });
        }
    }
}

export const startSoldFilesPurge = (supabase) => {
    if (!soldFilesPurgeEnabled()) {
        console.log('[SoldFilesPurge] disabled by USERBOT_SOLD_FILES_PURGE_ENABLED flag');
        return;
    }

    const intervalMs = getIntervalMs();
    console.log('[SoldFilesPurge] started', { interval_ms: intervalMs, window_hours: getShopFilesWindowHours() });

    let running = false;
    const run = () => {
        if (running) return;
        running = true;
        runSoldFilesPurge(supabase)
            .catch(error => {
                console.error('[SoldFilesPurge] run failed:', error?.message || error);
            })
            .finally(() => {
                running = false;
            });
    };

    run();
    setInterval(run, intervalMs);
};
