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

export async function purgeRestrictedUserbotAccount(supabase, ownerId, account, options = {}) {
    if (!account?.id) {
        return { deleted: false, reason: 'missing_account' };
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
