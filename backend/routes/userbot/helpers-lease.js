// Trial-proxy lease: аренда бесплатного прокси триальным админом через
// app_metadata пользователя (загрузка состояния, сохранение лизы,
// реконсилиация истёкших лиз, выборка свободных site_free_pool / shop_sale прокси).
// Вынесено дословно из userbot.routes.js на стадии 1 разрезки (2026-11-06).
import { getTierRules } from '../../utils/product-tier.js';
import { DEFAULT_ADMIN_PROXY_GROUP } from './constants.js';
import { supportsProxyInventoryGroup, supportsProxyProvisionSource } from './helpers-proxy.js';

async function loadFreeProxyClaimState(supabase, ownerId) {
    try {
        const { data, error } = await supabase.auth.admin.getUserById(ownerId);
        if (error) throw error;
        const claimedAt = data?.user?.app_metadata?.free_proxy_claimed_at || null;
        return {
            claimed: !!claimedAt,
            claimed_at: claimedAt
        };
    } catch (error) {
        console.error('Не удалось загрузить состояние старой выдачи прокси:', error);
        return {
            claimed: false,
            claimed_at: null
        };
    }
}

function buildTrialLeaseFromMetadata(appMetadata = {}) {
    const lease = appMetadata?.trial_proxy_lease;
    if (!lease || typeof lease !== 'object') {
        return {
            proxy_id: null,
            original_owner_id: null,
            claimed_at: null,
            expires_at: null,
            reclaimed_at: null
        };
    }

    return {
        proxy_id: lease.proxy_id || null,
        original_owner_id: lease.original_owner_id || null,
        claimed_at: lease.claimed_at || null,
        expires_at: lease.expires_at || null,
        reclaimed_at: lease.reclaimed_at || null
    };
}

async function loadUserMetadata(supabase, ownerId) {
    const { data, error } = await supabase.auth.admin.getUserById(ownerId);
    if (error) throw error;
    const appMetadata = data?.user?.app_metadata && typeof data.user.app_metadata === 'object'
        ? data.user.app_metadata
        : {};
    return { user: data?.user || null, appMetadata };
}

async function persistUserMetadata(supabase, ownerId, appMetadata) {
    const { error } = await supabase.auth.admin.updateUserById(ownerId, { app_metadata: appMetadata });
    if (error) throw error;
}

async function saveTrialProxyLease(supabase, ownerId, leasePatch) {
    const { appMetadata } = await loadUserMetadata(supabase, ownerId);
    const currentLease = buildTrialLeaseFromMetadata(appMetadata);
    await persistUserMetadata(supabase, ownerId, {
        ...appMetadata,
        free_proxy_claimed_at: appMetadata.free_proxy_claimed_at || leasePatch.claimed_at || new Date().toISOString(),
        trial_proxy_lease: {
            ...currentLease,
            ...leasePatch
        }
    });
}

function isLeaseExpired(expiresAt) {
    if (!expiresAt) return false;
    const expiresTs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresTs)) return false;
    return expiresTs <= Date.now();
}

async function reconcileExpiredTrialProxyLease(supabase, ownerId, profile) {
    const rules = getTierRules(profile);
    const { appMetadata } = await loadUserMetadata(supabase, ownerId);
    const lease = buildTrialLeaseFromMetadata(appMetadata);

    if (!lease.proxy_id || !lease.original_owner_id || !lease.expires_at || lease.reclaimed_at) {
        return {
            lease,
            expired: isLeaseExpired(lease.expires_at),
            reclaimed: false
        };
    }

    if (!isLeaseExpired(lease.expires_at)) {
        return {
            lease,
            expired: false,
            reclaimed: false
        };
    }

    const sourceSupported = await supportsProxyProvisionSource(supabase);
    const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
    const { data: proxy, error: proxyError } = await supabase
        .from('proxies')
        .select('id, owner_id')
        .eq('id', lease.proxy_id)
        .maybeSingle();

    if (proxyError) throw proxyError;

    if (proxy?.owner_id === ownerId) {
        const updatePayload = {
            owner_id: lease.original_owner_id
        };
        if (sourceSupported) {
            updatePayload.provision_source = 'manual_admin';
        }
        if (inventoryGroupSupported) {
            updatePayload.inventory_group = 'site_free_pool';
        }

        const { error: reclaimError } = await supabase
            .from('proxies')
            .update(updatePayload)
            .eq('id', lease.proxy_id)
            .eq('owner_id', ownerId);

        if (reclaimError) throw reclaimError;

        await supabase
            .from('tg_accounts')
            .update({
                proxy_id: null,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            })
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .eq('proxy_id', lease.proxy_id);
    }

    const nextLease = {
        ...lease,
        reclaimed_at: new Date().toISOString()
    };

    await persistUserMetadata(supabase, ownerId, {
        ...appMetadata,
        trial_proxy_lease: nextLease
    });

    return {
        lease: nextLease,
        expired: true,
        reclaimed: true,
        canUseTrialProxy: !!rules.canUseTrialProxy
    };
}

async function markFreeProxyClaimed(supabase, ownerId) {
    const { data, error } = await supabase.auth.admin.getUserById(ownerId);
    if (error) throw error;

    const currentAppMetadata = data?.user?.app_metadata && typeof data.user.app_metadata === 'object'
        ? data.user.app_metadata
        : {};

    if (currentAppMetadata.free_proxy_claimed_at) {
        return currentAppMetadata.free_proxy_claimed_at;
    }

    const claimedAt = new Date().toISOString();
    const { error: updateError } = await supabase.auth.admin.updateUserById(ownerId, {
        app_metadata: {
            ...currentAppMetadata,
            free_proxy_claimed_at: claimedAt
        }
    });
    if (updateError) throw updateError;
    return claimedAt;
}

async function loadAvailableSiteFreeProxy(supabase, sourceSupported, inventoryGroupSupported) {
    const { data: adminProfiles, error: adminError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

    if (adminError) throw adminError;

    const adminIds = (adminProfiles || []).map((row) => row.id).filter(Boolean);
    if (!adminIds.length) return null;

    const selectColumns = [
        'id',
        'owner_id',
        'name',
        'host',
        'port',
        'username',
        'password',
        'is_working',
        'last_check_country',
        'last_check_country_code'
    ];

    if (sourceSupported) selectColumns.push('provision_source');
    if (inventoryGroupSupported) selectColumns.push('inventory_group');

    const { data: proxies, error: proxiesError } = await supabase
        .from('proxies')
        .select(selectColumns.join(', '))
        .in('owner_id', adminIds)
        .order('created_at', { ascending: true });

    if (proxiesError) throw proxiesError;

    const { data: userbots, error: userbotsError } = await supabase
        .from('tg_accounts')
        .select('proxy_id')
        .eq('account_type', 'userbot')
        .in('owner_id', adminIds);

    if (userbotsError) throw userbotsError;

    const usedProxyIds = new Set((userbots || []).map((row) => String(row.proxy_id)).filter(Boolean));

    const available = (proxies || []).filter((proxy) => {
        const source = sourceSupported ? (proxy.provision_source || 'manual_free') : 'manual_free';
        const inventoryGroup = inventoryGroupSupported
            ? (proxy.inventory_group || (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null))
            : (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null);

        return source === 'manual_admin'
            && inventoryGroup === 'site_free_pool'
            && proxy.is_working !== false
            && !usedProxyIds.has(String(proxy.id));
    });

    return available[0] || null;
}

async function loadAvailableShopSaleProxies(supabase, sourceSupported, inventoryGroupSupported, limit = 6) {
    const { data: adminProfiles, error: adminError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

    if (adminError) throw adminError;

    const adminIds = (adminProfiles || []).map((row) => row.id).filter(Boolean);
    if (!adminIds.length) return [];

    const selectColumns = [
        'id',
        'owner_id',
        'name',
        'host',
        'port',
        'is_working',
        'last_check_country',
        'last_check_country_code',
        'last_check_city'
    ];

    if (sourceSupported) selectColumns.push('provision_source');
    if (inventoryGroupSupported) selectColumns.push('inventory_group');

    const { data: proxies, error: proxiesError } = await supabase
        .from('proxies')
        .select(selectColumns.join(', '))
        .in('owner_id', adminIds)
        .order('created_at', { ascending: false });

    if (proxiesError) throw proxiesError;

    const { data: userbots, error: userbotsError } = await supabase
        .from('tg_accounts')
        .select('proxy_id')
        .eq('account_type', 'userbot')
        .in('owner_id', adminIds);

    if (userbotsError) throw userbotsError;

    const usedProxyIds = new Set((userbots || []).map((row) => String(row.proxy_id)).filter(Boolean));

    return (proxies || [])
        .filter((proxy) => {
            const source = sourceSupported ? (proxy.provision_source || 'manual_free') : 'manual_free';
            const inventoryGroup = inventoryGroupSupported
                ? (proxy.inventory_group || (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null))
                : (source === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null);

            return source === 'manual_admin'
                && inventoryGroup === 'shop_sale'
                && proxy.is_working !== false
                && !usedProxyIds.has(String(proxy.id));
        })
        .slice(0, limit)
        .map((proxy) => ({
            id: proxy.id,
            name: proxy.name,
            host: proxy.host,
            port: proxy.port,
            last_check_country: proxy.last_check_country || null,
            last_check_country_code: proxy.last_check_country_code || null,
            last_check_city: proxy.last_check_city || null
        }));
}

export {
    loadFreeProxyClaimState,
    buildTrialLeaseFromMetadata,
    loadUserMetadata,
    persistUserMetadata,
    reconcileExpiredTrialProxyLease,
    loadAvailableSiteFreeProxy,
    loadAvailableShopSaleProxies
};
