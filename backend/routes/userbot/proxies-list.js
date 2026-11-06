// Список/состояние прокси и агентские приёмки прокси (стадия 2a разрезки userbot.routes.js).
// Зона: GET /proxies, GET /proxies/managed-health, GET /agent/infra-summary,
// POST /agent/proxy-intake/preview, POST /agent/proxy-intake/import.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import { enforceOwnedProxyQuota, getTierRules } from '../../utils/product-tier.js';
import {
    countManualFreeProxies,
    countOwnedManualProxies,
    isManagedProxyPending,
    maskCredential,
    normalizeAdminInventoryGroup,
    parseProxyPasteInput,
    supportsProxyInventoryGroup,
    supportsProxyProvisionSource
} from './helpers-proxy.js';
import {
    loadAvailableShopSaleProxies,
    loadAvailableSiteFreeProxy,
    loadFreeProxyClaimState,
    reconcileExpiredTrialProxyLease
} from './helpers-lease.js';
import {
    DEFAULT_ADMIN_PROXY_GROUP,
    MAX_MANAGED_PROXIES_GLOBAL,
    MAX_MANAGED_PROXIES_PER_ADMIN
} from './constants.js';

export function registerProxiesList(router, ctx) {
    const { supabase, managedProxyService } = ctx;
    router.get('/proxies', authenticateUser, async (req, res) => {
        try {
            const trialLeaseState = req.profile?.role === 'admin'
                ? { lease: { expires_at: null, reclaimed_at: null }, expired: false, reclaimed: false }
                : await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const tierRules = getTierRules(req.profile);
            const [{ data: proxies, error: proxiesError }, { data: userbots, error: userbotsError }] = await Promise.all([
                supabase
                    .from('proxies')
                    .select([
                        '*',
                        sourceSupported ? 'provision_source' : null,
                        inventoryGroupSupported ? 'inventory_group' : null
                    ].filter(Boolean).join(', '))
                    .eq('owner_id', req.user.id)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tg_accounts')
                    .select('id, tg_username, tg_account_id, proxy_id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
            ]);
            if (proxiesError) throw proxiesError;
            if (userbotsError) throw userbotsError;

            const proxyUsage = new Map();
            for (const account of userbots || []) {
                if (!account.proxy_id) continue;
                const key = String(account.proxy_id);
                if (!proxyUsage.has(key)) proxyUsage.set(key, []);
                proxyUsage.get(key).push({
                    id: account.id,
                    tg_username: account.tg_username || null,
                    tg_account_id: account.tg_account_id || null
                });
            }

            const enrichedProxies = (proxies || []).map(proxy => {
                const linkedUserbots = proxyUsage.get(String(proxy.id)) || [];
                const provisionSource = sourceSupported ? (proxy.provision_source || 'manual_free') : 'manual_free';
                const inventoryGroup = inventoryGroupSupported
                    ? (proxy.inventory_group || (provisionSource === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null))
                    : (provisionSource === 'manual_admin' ? DEFAULT_ADMIN_PROXY_GROUP : null);
                return {
                    ...proxy,
                    username: maskCredential(proxy.username),
                    password: null,
                    has_password: !!proxy.password,
                    provision_source: provisionSource,
                    inventory_group: inventoryGroup,
                    userbot_count: linkedUserbots.length,
                    is_safe_single_use: linkedUserbots.length <= 1,
                    is_pending: isManagedProxyPending(proxy),
                    linked_userbots: linkedUserbots
                };
            });

            const freeProxyClaimState = req.profile?.role === 'admin'
                ? { claimed: false, claimed_at: null }
                : await loadFreeProxyClaimState(supabase, req.user.id);
            const freeManualQuotaTotal = req.profile?.role === 'admin' ? null : 1;
            const freeManualQuotaUsed = req.profile?.role === 'admin'
                ? 0
                : await countManualFreeProxies(supabase, req.user.id, sourceSupported);
            const ownedProxyQuotaTotal = req.profile?.role === 'admin'
                ? null
                : tierRules.maxOwnedProxies;
            const ownedProxyQuotaUsed = req.profile?.role === 'admin'
                ? 0
                : await countOwnedManualProxies(supabase, req.user.id, sourceSupported);
            const siteFreePoolProxy = req.profile?.role === 'admin'
                ? null
                : await loadAvailableSiteFreeProxy(supabase, sourceSupported, inventoryGroupSupported);
            const shopSalePreview = req.profile?.role === 'admin'
                ? []
                : await loadAvailableShopSaleProxies(supabase, sourceSupported, inventoryGroupSupported);
            const managedProxySupport = req.profile?.role === 'admin'
                ? await managedProxyService.getSupport()
                : { supported: false };
            const managedProxySummary = req.profile?.role === 'admin'
                ? managedProxyService.getStateSummary()
                : { total: 0, groups: {} };

            res.json({
                proxies: enrichedProxies,
                support: {
                    profile_role: req.profile?.role || null,
                    source_supported: sourceSupported,
                    inventory_group_supported: inventoryGroupSupported,
                    can_sell_inventory: req.profile?.role === 'admin',
                    can_provision_server_inventory: req.profile?.role === 'admin',
                    free_manual_quota_total: freeManualQuotaTotal,
                    free_manual_quota_used: freeManualQuotaUsed,
                    owned_proxy_quota_total: ownedProxyQuotaTotal,
                    owned_proxy_quota_used: ownedProxyQuotaUsed,
                    max_owned_userbots: tierRules.maxUserbots,
                    free_proxy_claimed_once: freeProxyClaimState.claimed,
                    free_proxy_claimed_at: freeProxyClaimState.claimed_at,
                    can_buy_assets: !!tierRules.canBuyAssets,
                    can_create_manual_proxy: req.profile?.role === 'admin'
                        ? true
                        : (ownedProxyQuotaUsed < ownedProxyQuotaTotal || !Number.isFinite(ownedProxyQuotaTotal)),
                    shop_sale_proxy_count: shopSalePreview.length,
                    shop_sale_proxy_preview: shopSalePreview,
                    next_proxy_requires_purchase: req.profile?.role !== 'admin'
                        ? (freeProxyClaimState.claimed || freeManualQuotaUsed >= freeManualQuotaTotal)
                        : false,
                    managed_proxy_limits: req.profile?.role === 'admin' ? {
                        total: managedProxySummary.total || 0,
                        per_admin_limit: MAX_MANAGED_PROXIES_PER_ADMIN,
                        global_limit: MAX_MANAGED_PROXIES_GLOBAL,
                        self_use: Number(managedProxySummary.groups?.self_use || 0),
                        shop_sale: Number(managedProxySummary.groups?.shop_sale || 0)
                    } : null,
                    managed_proxy: managedProxySupport
                }
            });
        } catch (error) {
            const statusCode = (error.message || '').includes('Без прокси можно держать только один юзербот') ? 400 : 500;
            res.status(statusCode).json({ error: error.message });
        }
    });

    router.get('/proxies/managed-health', authenticateUser, async (req, res) => {
        if (req.profile?.role !== 'admin') {
            return res.status(403).json({ error: 'Managed proxy health доступен только админу.' });
        }

        try {
            const health = await managedProxyService.getRuntimeHealth(supabase);
            res.json({
                success: true,
                health
            });
        } catch (error) {
            res.status(500).json({
                error: error?.message || 'Не удалось проверить managed proxy runtime.'
            });
        }
    });

    router.get('/agent/infra-summary', authenticateUser, async (req, res) => {
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const tierRules = getTierRules(req.profile);
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, req.user.id);

            const [{ data: proxies, error: proxiesError }, { data: accounts, error: accountsError }] = await Promise.all([
                supabase
                    .from('proxies')
                    .select([
                        'id, name, host, port, is_working, last_checked_at, last_check_error',
                        sourceSupported ? 'provision_source' : null,
                        inventoryGroupSupported ? 'inventory_group' : null
                    ].filter(Boolean).join(', '))
                    .eq('owner_id', req.user.id),
                supabase
                    .from('tg_accounts')
                    .select('id, account_type, tg_username, tg_account_id, runtime_status, proxy_id')
                    .eq('owner_id', req.user.id)
            ]);

            if (proxiesError) throw proxiesError;
            if (accountsError) throw accountsError;

            const allProxies = proxies || [];
            const allAccounts = accounts || [];
            const liveUserbots = allAccounts.filter((item) =>
                item.account_type === 'userbot' &&
                !reservedUserbotIds.has(String(item.id))
            );
            const reservedUserbots = allAccounts.filter((item) =>
                item.account_type === 'userbot' &&
                reservedUserbotIds.has(String(item.id))
            );

            const summary = {
                profile_role: req.profile?.role || null,
                product_tier: tierRules.id,
                proxy_total: allProxies.length,
                proxy_working: allProxies.filter((item) => item.is_working === true).length,
                proxy_broken: allProxies.filter((item) => item.is_working === false).length,
                proxy_unchecked: allProxies.filter((item) => item.is_working !== true && item.is_working !== false).length,
                proxy_owned_manual: allProxies.filter((item) => (item.provision_source || 'manual_free') === 'manual_owned').length,
                proxy_purchased: allProxies.filter((item) => (item.provision_source || 'manual_free') === 'purchased').length,
                proxy_admin_inventory: allProxies.filter((item) => (item.provision_source || 'manual_free') === 'manual_admin').length,
                userbot_total: liveUserbots.length,
                userbot_online: liveUserbots.filter((item) => item.runtime_status === 'online').length,
                userbot_problem: liveUserbots.filter((item) => ['dead_proxy', 'expired', 'error', 'restricted'].includes(item.runtime_status)).length,
                userbot_reserved_for_shop: reservedUserbots.length,
                max_owned_proxies: tierRules.maxOwnedProxies,
                max_userbots: tierRules.maxUserbots,
                can_buy_assets: !!tierRules.canBuyAssets
            };

            res.json({
                summary,
                proxies: allProxies.map((item) => ({
                    id: item.id,
                    name: item.name,
                    host: item.host,
                    port: item.port,
                    is_working: item.is_working,
                    last_checked_at: item.last_checked_at || null,
                    last_check_error: item.last_check_error || null,
                    provision_source: item.provision_source || 'manual_free',
                    inventory_group: item.inventory_group || null
                })),
                userbots: liveUserbots.map((item) => ({
                    id: item.id,
                    tg_username: item.tg_username || null,
                    tg_account_id: item.tg_account_id || null,
                    runtime_status: item.runtime_status || null,
                    proxy_id: item.proxy_id || null
                }))
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось собрать агентный summary.' });
        }
    });

    router.post('/agent/proxy-intake/preview', authenticateUser, async (req, res) => {
        try {
            const parsed = parseProxyPasteInput(req.body?.raw || '');
            res.json({
                success: true,
                parsed,
                message: 'Proxy разобран. Можно показать пользователю preview и только потом сохранять.'
            });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Не удалось разобрать proxy.' });
        }
    });

    router.post('/agent/proxy-intake/import', authenticateUser, async (req, res) => {
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const isAdmin = req.profile?.role === 'admin';
            const parsed = parseProxyPasteInput(req.body?.raw || '');
            const name = String(req.body?.name || '').trim() || `${parsed.host}:${parsed.port}`;
            const normalizedInventoryGroup = normalizeAdminInventoryGroup(req.body?.inventory_group);

            if (!isAdmin) {
                await enforceOwnedProxyQuota({
                    supabase,
                    ownerId: req.user.id,
                    profile: req.profile
                });
            }

            const proxyData = {
                owner_id: req.user.id,
                name,
                host: parsed.host,
                port: parsed.port,
                username: parsed.username,
                password: parsed.password,
                is_working: null,
                last_checked_at: null,
                last_check_ip: null,
                last_check_country: null,
                last_check_city: null,
                last_check_isp: null,
                last_check_error: null
            };

            if (sourceSupported) {
                proxyData.provision_source = isAdmin ? 'manual_admin' : 'manual_owned';
            }
            if (inventoryGroupSupported && isAdmin) {
                proxyData.inventory_group = normalizedInventoryGroup;
            }

            const { data: duplicateProxy } = await supabase
                .from('proxies')
                .select('id')
                .eq('owner_id', req.user.id)
                .eq('host', parsed.host)
                .eq('port', parsed.port)
                .maybeSingle();
            if (duplicateProxy) {
                return res.status(400).json({ error: 'Такой прокси уже добавлен' });
            }

            const { data: inserted, error } = await supabase
                .from('proxies')
                .insert([proxyData])
                .select('id, name, host, port')
                .single();

            if (error) throw error;

            res.json({
                success: true,
                proxy: inserted,
                parsed,
                message: 'Proxy сохранён из вставленного текста.'
            });
        } catch (error) {
            if (error?.code === '23505' || String(error?.message || '').includes('duplicate key')) {
                return res.status(400).json({ error: 'Такой прокси уже добавлен' });
            }
            const message = error?.message || 'Не удалось импортировать proxy.';
            const statusCode = message.includes('Trial') ? 403 : 400;
            res.status(statusCode).json({ error: message });
        }
    });

}
