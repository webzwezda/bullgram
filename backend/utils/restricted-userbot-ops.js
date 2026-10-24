import { ManagedProxyService } from '../services/managed-proxy.service.js';
import { unpublishShopItemsByUserbotId } from './shop-reservations.js';

export async function unpublishRestrictedUserbotListings(supabase, ownerId, userbotId, reason = '') {
    try {
        const result = await unpublishShopItemsByUserbotId(supabase, ownerId, userbotId);
        if (result.updatedCount > 0) {
            console.error('[ShopGuard] Сняли с продажи лоты юзербота после ограничения Telegram:', {
                owner_id: ownerId,
                userbot_id: userbotId,
                reason,
                item_ids: result.itemIds
            });
        }
        return result;
    } catch (error) {
        console.error('[ShopGuard] Не удалось снять с продажи лоты ограниченного юзербота:', error);
        return { updatedCount: 0, itemIds: [] };
    }
}

export async function cleanupRestrictedUserbotProxy(supabase, managedProxyService, ownerId, account) {
    const proxyId = account?.proxy_id ? String(account.proxy_id) : '';
    if (!proxyId) {
        return { deleted: false, released: false, reason: 'no_proxy' };
    }

    const { count: linkedUserbotCount, error: countError } = await supabase
        .from('tg_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .eq('proxy_id', proxyId);

    if (countError) throw countError;
    if (Number(linkedUserbotCount || 0) > 1) {
        return { deleted: false, released: false, reason: 'shared_proxy' };
    }

    const { data: proxy, error: proxyError } = await supabase
        .from('proxies')
        .select('id, host, port, username, provision_source')
        .eq('id', proxyId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (proxyError) throw proxyError;
    if (!proxy) {
        return { deleted: false, released: false, reason: 'proxy_missing' };
    }

    const { error: unlinkError } = await supabase
        .from('tg_accounts')
        .update({
            proxy_id: null,
            allow_proxy_failover: false,
            failover_proxy_ids: []
        })
        .eq('id', account.id)
        .eq('owner_id', ownerId);

    if (unlinkError) throw unlinkError;

    const { error: deleteError } = await supabase
        .from('proxies')
        .delete()
        .eq('id', proxyId)
        .eq('owner_id', ownerId);

    if (deleteError) throw deleteError;

    let released = false;
    if (proxy.provision_source === 'manual_admin' && proxy.username) {
        released = await managedProxyService.releaseManagedProxy({
            host: proxy.host,
            port: proxy.port,
            username: proxy.username
        });
    }

    console.error('[ShopGuard] Удалили прокси ограниченного юзербота:', {
        owner_id: ownerId,
        userbot_id: account.id,
        proxy_id: proxyId,
        released
    });

    return {
        deleted: true,
        released,
        reason: 'deleted'
    };
}

function isMissingTableError(error) {
    if (!error) return false;
    return error.code === '42P01'
        || String(error.message || '').includes('does not exist')
        || String(error.message || '').includes('Could not find the table');
}

export async function hasActiveShopPurchases(supabase, ownerId, userbotId) {
    try {
        const { data: assets, error: assetsError } = await supabase
            .from('shop_item_assets')
            .select('shop_item_id')
            .eq('asset_type', 'userbot')
            .eq('asset_id', String(userbotId));
        if (assetsError) {
            // Магазин в этой инсталляции не поднят — покупок нет по определению.
            if (isMissingTableError(assetsError)) return false;
            throw assetsError;
        }
        const itemIds = Array.from(new Set((assets || []).map(row => String(row.shop_item_id))));
        if (!itemIds.length) return false;

        const { data: purchases, error: purchasesError } = await supabase
            .from('shop_purchases')
            .select('id, status, ownership_transfer_status')
            .in('shop_item_id', itemIds);
        if (purchasesError) {
            if (isMissingTableError(purchasesError)) return false;
            throw purchasesError;
        }
        return (purchases || []).some(purchase =>
            ['pending', 'paid'].includes(String(purchase.status || '')) &&
            String(purchase.ownership_transfer_status || '') !== 'completed'
        );
    } catch (error) {
        // Fail-safe: не смогли проверить — пурж откладываем, а не рискуем
        // удалить аккаунт под живой покупкой.
        console.error('[ShopGuard] Не удалось проверить активные покупки перед пуржем:', error?.message || error);
        return true;
    }
}

export async function purgeRestrictedUserbotAccount(supabase, ownerId, account, options = {}) {
    if (!account?.id) {
        return { deleted: false, reason: 'missing_account' };
    }

    // Отстойник: живая покупка на лот — деньги уже у площадки, удалять аккаунт
    // нельзя, иначе покупатель останется и без денег, и без товара. Пурж отложится
    // до следующих прогонов, пока покупка не завершится или не истечёт.
    if (await hasActiveShopPurchases(supabase, ownerId, account.id)) {
        console.error('[RestrictedUserbotCleanup] Пропустили пурж: на лот юзербота есть живая покупка', {
            owner_id: ownerId,
            userbot_id: account.id
        });
        return { deleted: false, reason: 'active_purchase' };
    }

    const managedProxyService = options.managedProxyService || new ManagedProxyService();

    await unpublishRestrictedUserbotListings(supabase, ownerId, account.id, options.reason || 'restricted_cleanup');
    const proxyCleanup = await cleanupRestrictedUserbotProxy(supabase, managedProxyService, ownerId, account);

    const { error: restoreSourceError } = await supabase
        .from('userbot_restore_sources')
        .delete()
        .eq('owner_id', ownerId)
        .eq('account_id', account.id);
    if (restoreSourceError && !String(restoreSourceError.message || '').includes('userbot_restore_sources')) {
        throw restoreSourceError;
    }

    const { error: inboxError } = await supabase
        .from('userbot_inbox_notifications')
        .delete()
        .eq('owner_id', ownerId)
        .eq('userbot_id', account.id);
    if (inboxError && !String(inboxError.message || '').includes('userbot_inbox_notifications')) {
        throw inboxError;
    }

    const { error: deleteAccountError } = await supabase
        .from('tg_accounts')
        .delete()
        .eq('id', account.id)
        .eq('owner_id', ownerId);
    if (deleteAccountError) throw deleteAccountError;

    console.error('[RestrictedUserbotCleanup] Удалили ограниченный юзербот после карантина:', {
        owner_id: ownerId,
        userbot_id: account.id,
        proxy_cleanup: proxyCleanup
    });

    return {
        deleted: true,
        proxy_cleanup: proxyCleanup
    };
}
