import express from 'express';
import { UserbotService } from '../services/userbot.service.js';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { ManagedProxyService } from '../services/managed-proxy.service.js';
import { enforceOwnedProxyQuota, enforceUserbotQuota, getTierRules } from '../utils/product-tier.js';
import { logTelegramErrorEvent } from '../utils/telegram-error-events.js';
import { cleanupRestrictedUserbotProxy, unpublishRestrictedUserbotListings } from '../utils/restricted-userbot-ops.js';
import {
    FRESH_IMPORT_RUNTIME_STATUS,
    FRESH_IMPORT_RUNTIME_REASON,
    isFreshImportedUserbot,
    resolveOpsCenterSelection
} from '../utils/ops-center-selection.js';
import { buildTelegramProfilePatch, buildHealthSummary } from '../utils/telegram-profile.js';
import { buildBatchProxyNames, buildManagedProxyPendingMessage } from '../utils/proxy-batch.js';
import { groupAccountPacks, normalizeEntries, unpackZipEntries } from '../services/account-pack.service.js';
import { processIntakeBatch } from '../services/account-intake.service.js';

// Настраиваем загрузку файлов во временную папку сервера
const upload = multer({
    dest: os.tmpdir(),
    limits: {
        files: 2,
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: (_req, file, callback) => {
        const field = String(file?.fieldname || '').trim();
        const name = String(file?.originalname || '').trim().toLowerCase();

        if (field === 'sessionFile') {
            callback(null, name.endsWith('.session'));
            return;
        }

        if (field === 'jsonFile') {
            callback(null, name.endsWith('.json'));
            return;
        }

        callback(null, false);
    }
});

// Приёмка пачек аккаунтов: zip и loose-файлы, поле `files` (до 400 файлов по 30 МБ).
const intakeUpload = multer({
    dest: os.tmpdir(),
    limits: {
        files: 400,
        fileSize: 30 * 1024 * 1024
    }
});
const MAX_MANAGED_PROXIES_PER_ADMIN = 256;
const MAX_MANAGED_PROXIES_GLOBAL = 512;
export const MAX_MANAGED_PROXY_BATCH = 100;
export const DEFAULT_ADMIN_PROXY_GROUP = 'shop_sale';
const TRIAL_PROXY_LEASE_HOURS = 24;
// Лимит одной приёмки пачек аккаунтов (POST /intake/batch): 100 аккаунтов за раз.
const MAX_INTAKE_BATCH = 100;
export const USERBOT_PROFILE_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
export const USERBOT_PROFILE_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'userbot-profiles');
const USERBOT_CENTER_DIALOG_LIMIT = Number(process.env.USERBOT_CENTER_DIALOG_LIMIT || 80);
const USERBOT_CENTER_ADMIN_CHECK_DELAY_MS = Number(process.env.USERBOT_CENTER_ADMIN_CHECK_DELAY_MS || 350);
const USERBOT_HEALTH_CONNECT_TIMEOUT_MS = Number(process.env.USERBOT_HEALTH_CONNECT_TIMEOUT_MS || 25000);
const USERBOT_HEALTH_INSPECT_TIMEOUT_MS = Number(process.env.USERBOT_HEALTH_INSPECT_TIMEOUT_MS || 35000);

// Module-level хелперы вынесены в routes/userbot/ (стадия 1 разрезки монстра).
// Фабрика роутера ниже осталась без изменений.
import {
    buildCheckResponse,
    detectSalesSignal,
    getDeadProxyMessage,
    getFailoverCooldownMessage,
    isExpiredUserbotSessionError,
    isMissingRecoveryTable,
    isUserbotDmEnabled,
    isUserbotOnDeadProxy,
    loadOperationalUserbot,
    normalizeMessageDate,
    parseTelegramInvite,
    sanitizeUserbotImportError,
    shouldStoreRecoverySource,
    sleep,
    storeUserbotProfilePhoto,
    userbotProfileSyncCooldown,
    withTimeout
} from './userbot/helpers-core.js';
import {
    buildUserbotCenterAccount,
    buildUserbotCenterSignalConfig,
    buildUserbotCenterSummary,
    loadUserbotCenterCache,
    normalizeEditableTelegramProfile,
    normalizeFingerprintPayload,
    replaceUserbotCenterCache,
    resolveBatchKickCallSource,
    validateCustomFingerprintPayload
} from './userbot/helpers-center.js';
import {
    cleanupUploadedFiles,
    countManualFreeProxies,
    countOwnedManualProxies,
    ensureExclusiveProxyAssignment,
    ensureUserbotNotOwnedByAnotherAdmin,
    isManagedProxyPending,
    launchManagedProxyVerification,
    loadOwnedProxy,
    maskCredential,
    normalizeAdminInventoryGroup,
    normalizeManagedBatchCount,
    parseProxyPasteInput,
    PROXY_CHECK_COOLDOWN_MS,
    proxyCheckCooldown,
    supportsProxyInventoryGroup,
    supportsProxyProvisionSource
} from './userbot/helpers-proxy.js';
import {
    buildTrialLeaseFromMetadata,
    loadAvailableShopSaleProxies,
    loadAvailableSiteFreeProxy,
    loadFreeProxyClaimState,
    loadUserMetadata,
    persistUserMetadata,
    reconcileExpiredTrialProxyLease
} from './userbot/helpers-lease.js';

export default function (supabase) {
    const router = express.Router();

    // api_id/api_hash подставляет конструктор UserbotService из дефолтного отпечатка.
    const userbotService = new UserbotService(supabase);
    const managedProxyService = new ManagedProxyService();

    // ==========================================
    // 1. УПРАВЛЕНИЕ ПУЛОМ ПРОКСИ
    // ==========================================
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

    router.post('/proxies', authenticateUser, async (req, res) => {
        const { id, name, host, port, username, password, inventory_group, count } = req.body;
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const isAdmin = req.profile?.role === 'admin';
            const isCreate = !id;
            const normalizedHost = String(host || '').trim();
            const normalizedPort = Number.parseInt(port, 10);
            const normalizedInventoryGroup = normalizeAdminInventoryGroup(inventory_group);

            if (!String(name || '').trim()) {
                return res.status(400).json({ error: 'Дай прокси понятное имя, чтобы потом не гадать, что это за контур.' });
            }

            if (!isAdmin && !normalizedHost) {
                return res.status(400).json({ error: 'Укажи host или IP прокси.' });
            }
            if (!isAdmin && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
                return res.status(400).json({ error: 'Укажи корректный порт прокси.' });
            }
            if (isAdmin && normalizedHost && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
                return res.status(400).json({ error: 'Если заводишь внешний прокси вручную, укажи корректный порт.' });
            }

            if (isCreate && !isAdmin) {
                await enforceOwnedProxyQuota({
                    supabase,
                    ownerId: req.user.id,
                    profile: req.profile
                });
            }

            if (!isCreate && !isAdmin) {
                const existingProxy = await loadOwnedProxy(supabase, req.user.id, id);
                if (!existingProxy) {
                    return res.status(404).json({ error: 'Прокси не найден.' });
                }
                if ((existingProxy.provision_source || 'manual_free') !== 'manual_owned') {
                    return res.status(403).json({
                        error: 'Редактировать вручную можно только свой proxy. Trial и купленные proxy руками не правим.'
                    });
                }
            }

            if (isCreate && isAdmin && !normalizedHost) {
                const batchCount = normalizeManagedBatchCount(count);
                const managedSummary = managedProxyService.getStateSummary();
                if (Number(managedSummary.total || 0) + batchCount > MAX_MANAGED_PROXIES_GLOBAL) {
                    const freeSlots = Math.max(0, MAX_MANAGED_PROXIES_GLOBAL - Number(managedSummary.total || 0));
                    return res.status(403).json({
                        error: `На сервере лимит managed-прокси (${MAX_MANAGED_PROXIES_GLOBAL}). Свободно слотов: ${freeSlots}.`
                    });
                }

                const { count: ownerManagedCount, error: ownerCountError } = await supabase
                    .from('proxies')
                    .select('*', { count: 'exact', head: true })
                    .eq('owner_id', req.user.id)
                    .eq('provision_source', 'manual_admin');

                if (ownerCountError) throw ownerCountError;

                if (Number(ownerManagedCount || 0) + batchCount > MAX_MANAGED_PROXIES_PER_ADMIN) {
                    const freeSlots = Math.max(0, MAX_MANAGED_PROXIES_PER_ADMIN - Number(ownerManagedCount || 0));
                    return res.status(403).json({
                        error: `У одного админа нельзя держать больше ${MAX_MANAGED_PROXIES_PER_ADMIN} серверных прокси. Свободно слотов: ${freeSlots}.`
                    });
                }

                let proxyNames = [String(name || '').trim()];
                if (batchCount > 1) {
                    const { data: ownerProxies, error: ownerProxiesError } = await supabase
                        .from('proxies')
                        .select('name')
                        .eq('owner_id', req.user.id);
                    if (ownerProxiesError) throw ownerProxiesError;
                    proxyNames = buildBatchProxyNames(
                        String(name || '').trim(),
                        (ownerProxies || []).map((row) => row.name),
                        batchCount
                    );
                }

                const provisionedProxies = await managedProxyService.provisionManagedProxyBatch({
                    count: batchCount,
                    inventoryGroup: normalizedInventoryGroup
                });

                const proxyRows = provisionedProxies.map((provisionedProxy, index) => {
                    const proxyData = {
                        owner_id: req.user.id,
                        name: proxyNames[index],
                        host: provisionedProxy.host,
                        port: provisionedProxy.port,
                        username: provisionedProxy.username,
                        password: provisionedProxy.password,
                        is_working: null,
                        last_checked_at: new Date().toISOString(),
                        last_check_ip: null,
                        last_check_country: null,
                        last_check_city: null,
                        last_check_isp: null,
                        last_check_error: buildManagedProxyPendingMessage()
                    };

                    if (sourceSupported) {
                        proxyData.provision_source = 'manual_admin';
                    }
                    if (inventoryGroupSupported) {
                        proxyData.inventory_group = provisionedProxy.inventory_group;
                    }
                    return proxyData;
                });

                const { data: insertedProxies, error: insertError } = await supabase
                    .from('proxies')
                    .insert(proxyRows)
                    .select('id, host, port, username, password');
                if (insertError) {
                    await managedProxyService.releaseManagedProxyBatch({ records: provisionedProxies });
                    throw insertError;
                }

                for (const insertedProxy of insertedProxies || []) {
                    launchManagedProxyVerification({
                        supabase,
                        userbotService,
                        ownerId: req.user.id,
                        proxyId: insertedProxy.id,
                        host: insertedProxy.host,
                        port: insertedProxy.port,
                        username: insertedProxy.username,
                        password: insertedProxy.password
                    });
                }

                return res.json({
                    success: true,
                    managed: true,
                    created: (insertedProxies || []).length,
                    proxy_ids: (insertedProxies || []).map((proxy) => proxy.id),
                    verification_status: 'pending',
                    message: (insertedProxies || []).length > 1
                        ? `Поднято ${(insertedProxies || []).length} прокси. ${buildManagedProxyPendingMessage()}`
                        : buildManagedProxyPendingMessage()
                });
            }

            let result;

            if (id) {
                const existingProxy = await loadOwnedProxy(supabase, req.user.id, id);
                if (!existingProxy) {
                    return res.status(404).json({ error: 'Прокси не найден.' });
                }

                // GET отдаёт креды маскированными (username маскирован, password нет),
                // поэтому пустой или замаскированный username и пустой password в апдейте
                // означают «оставить как есть», а не «затереть» — иначе правка формы или
                // перенос в группу стирает настоящие креды прокси.
                const incomingUsername = String(username || '').trim();
                const incomingPassword = String(password || '');
                const keepUsername = !incomingUsername || incomingUsername === maskCredential(existingProxy.username);
                const keepPassword = !incomingPassword;
                const nextUsername = keepUsername ? (existingProxy.username || null) : incomingUsername;
                const nextPassword = keepPassword ? (existingProxy.password || null) : incomingPassword;

                const updatePayload = {
                    name: String(name || '').trim(),
                    host: normalizedHost,
                    port: normalizedPort,
                    username: nextUsername,
                    password: nextPassword
                };

                if (inventoryGroupSupported && isAdmin) {
                    updatePayload.inventory_group = normalizedInventoryGroup;
                }

                const connectionChanged =
                    String(existingProxy.host || '') !== String(normalizedHost || '') ||
                    Number(existingProxy.port || 0) !== Number(normalizedPort || 0) ||
                    String(existingProxy.username || '') !== String(nextUsername || '') ||
                    String(existingProxy.password || '') !== String(nextPassword || '');

                if (connectionChanged) {
                    updatePayload.is_working = null;
                    updatePayload.last_checked_at = null;
                    updatePayload.last_check_ip = null;
                    updatePayload.last_check_country = null;
                    updatePayload.last_check_country_code = null;
                    updatePayload.last_check_city = null;
                    updatePayload.last_check_isp = null;
                    updatePayload.last_check_error = null;
                }

                result = await supabase
                    .from('proxies')
                    .update(updatePayload)
                    .eq('id', id)
                    .eq('owner_id', req.user.id);
            } else {
                const { data: duplicateProxy } = await supabase
                    .from('proxies')
                    .select('id')
                    .eq('owner_id', req.user.id)
                    .eq('host', normalizedHost)
                    .eq('port', normalizedPort)
                    .maybeSingle();
                if (duplicateProxy) {
                    return res.status(400).json({ error: 'Такой прокси уже добавлен' });
                }

                const proxyData = {
                    owner_id: req.user.id,
                    name: String(name || '').trim(),
                    host: normalizedHost,
                    port: normalizedPort,
                    username: username || null,
                    password: password || null,
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

                result = await supabase.from('proxies').insert([proxyData]).select('id');
            }
            if (result.error) throw result.error;
            // proxy_ids нужен инлайн-панели на /userbot: она подставляет созданный
            // прокси в шаг 1 подключения аккаунта. У update-ветки data === null —
            // ключ не добавляется.
            res.json({
                success: true,
                ...(Array.isArray(result.data) ? { proxy_ids: result.data.map((row) => row.id) } : {})
            });
        } catch (error) {
            if (error?.code === '23505' || String(error?.message || '').includes('duplicate key')) {
                return res.status(400).json({ error: 'Такой прокси уже добавлен' });
            }
            const message = error?.message || 'Не удалось сохранить прокси.';
            const statusCode = (
                message.includes('trial proxy') ||
                message.includes('Shop')
            ) ? 403 : 500;
            res.status(statusCode).json({ error: message });
        }
    });

    router.delete('/proxies/:id', authenticateUser, async (req, res) => {
        try {
            const sourceSupported = await supportsProxyProvisionSource(supabase);
            const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
            const { data: proxy, error: fetchError } = await supabase
                .from('proxies')
                .select('id, owner_id, host, port, username, provision_source')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (fetchError) throw fetchError;
            if (!proxy) {
                return res.status(404).json({ error: 'Прокси не найден.' });
            }

            if (proxy.provision_source === 'manual_trial') {
                const { appMetadata } = await loadUserMetadata(supabase, req.user.id);
                const lease = buildTrialLeaseFromMetadata(appMetadata);
                const updatePayload = {
                    owner_id: lease.original_owner_id || req.user.id
                };
                if (sourceSupported) {
                    updatePayload.provision_source = 'manual_admin';
                }
                if (inventoryGroupSupported) {
                    updatePayload.inventory_group = 'site_free_pool';
                }

                const { error: returnError } = await supabase
                    .from('proxies')
                    .update(updatePayload)
                    .eq('id', req.params.id)
                    .eq('owner_id', req.user.id);
                if (returnError) throw returnError;

                await supabase
                    .from('tg_accounts')
                    .update({
                        proxy_id: null,
                        allow_proxy_failover: false,
                        failover_proxy_ids: []
                    })
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .eq('proxy_id', req.params.id);

                await persistUserMetadata(supabase, req.user.id, {
                    ...appMetadata,
                    trial_proxy_lease: {
                        ...lease,
                        reclaimed_at: new Date().toISOString()
                    }
                });

                return res.json({ success: true, returned_to_trial_pool: true });
            }

            // FK tg_accounts.proxy_id -> proxies ON DELETE SET NULL молча отвяжет
            // живого юзербота, поэтому перед удалением требуем ручную развязку.
            const { count: linkedAccounts, error: linkedError } = await supabase
                .from('tg_accounts')
                .select('id', { count: 'exact', head: true })
                .eq('owner_id', req.user.id)
                .eq('proxy_id', req.params.id);

            if (linkedError) throw linkedError;
            if (Number(linkedAccounts || 0) > 0) {
                return res.status(400).json({ error: 'Прокси использует юзербот — сначала перепривяжи или удали его' });
            }

            const { error } = await supabase.from('proxies').delete().eq('id', req.params.id).eq('owner_id', req.user.id);
            if (error) throw error;

            if (proxy?.username) {
                await managedProxyService.releaseManagedProxy({
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username
                });
            }

            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ==========================================
    // НОВОЕ: ПРОВЕРКА ПРОКСИ НА ЖИВУЧЕСТЬ
    // ==========================================
    router.get('/proxies/check/:id', authenticateUser, async (req, res) => {
        try {
            const { data: proxy, error } = await supabase
            .from('proxies')
            .select('*')
            .eq('id', req.params.id)
            .eq('owner_id', req.user.id)
            .single();

            if (error || !proxy) return res.status(404).json({ error: 'Прокси не найден' });
            if (!proxy.host || !proxy.port) {
                return res.status(400).json({ error: 'У этого прокси не сохранены host/port. Открой прокси, поправь данные и только потом запускай проверку.' });
            }

            const cooldownKey = `${req.user.id}:${proxy.id}`;
            const now = Date.now();
            const lastCheckAt = proxyCheckCooldown.get(cooldownKey) || 0;
            if (now - lastCheckAt < PROXY_CHECK_COOLDOWN_MS) {
                return res.status(429).json({ error: 'Подожди немного перед повторной проверкой' });
            }
            if (proxyCheckCooldown.size > 1000) {
                for (const [key, ts] of proxyCheckCooldown) {
                    if (now - ts >= PROXY_CHECK_COOLDOWN_MS) proxyCheckCooldown.delete(key);
                }
            }
            proxyCheckCooldown.set(cooldownKey, now);

            const result = await userbotService.checkProxy({
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: proxy.password,
                provision_source: proxy.provision_source || null,
                is_working: proxy.is_working,
                last_check_ip: proxy.last_check_ip || null,
                last_check_country: proxy.last_check_country || null,
                last_check_city: proxy.last_check_city || null,
                force_ipv6: !proxy.last_check_ip || proxy.last_check_ip.includes(':')
            });

            if (result.success) {
                await supabase.from('proxies').update({
                    is_working: true,
                    last_checked_at: new Date().toISOString(),
                    last_check_ip: result.ip,
                    last_check_country: result.country,
                    last_check_country_code: result.countryCode || null,
                    last_check_city: result.city,
                    last_check_isp: result.isp,
                    last_check_error: null
                }).eq('id', proxy.id).eq('owner_id', req.user.id);

                res.json({
                    success: true,
                    ip: result.ip,
                    country: result.country,
                    countryCode: result.countryCode || null,
                    city: result.city,
                    isp: result.isp
                });
            } else {
                await supabase.from('proxies').update({
                    is_working: false,
                    last_checked_at: new Date().toISOString(),
                    last_check_error: result.error,
                    last_check_ip: null,
                    last_check_country: null,
                    last_check_country_code: null,
                    last_check_city: null,
                    last_check_isp: null
                }).eq('id', proxy.id).eq('owner_id', req.user.id);

                res.json({ success: false, error: result.error });
            }
        } catch (error) {
            res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
        }
    });

    router.post('/bind-proxy', authenticateUser, async (req, res) => {
        const { account_id, proxy_id, allow_proxy_failover, failover_proxy_ids } = req.body;
        try {
            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }
            if (!account_id) {
                return res.status(400).json({ error: 'Не передан аккаунт для перепривязки прокси' });
            }

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота нельзя оставлять без прокси. Выбери живой прокси и только потом сохраняй.' });
            }

            const primaryProxy = await loadOwnedProxy(supabase, req.user.id, proxy_id);
            if (!primaryProxy) {
                return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
            }
            if (primaryProxy.is_working === false) {
                return res.status(400).json({ error: 'Нельзя привязать заведомо мертвый прокси. Сначала почини или выбери другой.' });
            }
            await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id, account_id);

            const normalizedPool = Array.isArray(failover_proxy_ids)
                ? failover_proxy_ids.map(item => String(item)).filter(Boolean)
                : [];

            if (proxy_id && normalizedPool.includes(String(proxy_id))) {
                return res.status(400).json({ error: 'Основной прокси не должен одновременно быть fallback-прокси для этого же аккаунта.' });
            }

            if (normalizedPool.length > 0) {
                const { data: proxies, error: proxiesError } = await supabase
                    .from('proxies')
                    .select('id, is_working')
                    .eq('owner_id', req.user.id)
                    .in('id', normalizedPool);

                if (proxiesError) throw proxiesError;
                const validIds = new Set((proxies || []).map(proxy => String(proxy.id)));
                const invalidIds = normalizedPool.filter(id => !validIds.has(id));
                if (invalidIds.length > 0) {
                    return res.status(400).json({ error: 'В fallback-пуле есть чужие или несуществующие прокси.' });
                }

                const deadPool = (proxies || []).filter(proxy => proxy.is_working === false);
                if (deadPool.length > 0) {
                    return res.status(400).json({ error: 'В fallback-пуле есть уже помеченные мертвые прокси. Убери их из резерва.' });
                }

                const { data: occupiedFallbackRows, error: occupiedFallbackError } = await supabase
                    .from('tg_accounts')
                    .select('proxy_id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .neq('id', account_id)
                    .in('proxy_id', normalizedPool);

                if (occupiedFallbackError) throw occupiedFallbackError;

                const occupiedFallbackIds = new Set(
                    (occupiedFallbackRows || [])
                        .map((row) => String(row.proxy_id || ''))
                        .filter(Boolean)
                );

                if (occupiedFallbackIds.size > 0) {
                    return res.status(400).json({ error: 'В fallback-пуле есть прокси, которые уже заняты другими юзерботами. Один прокси = один юзербот даже для резерва.' });
                }
            }

            const { error } = await supabase.from('tg_accounts').update({
                proxy_id: proxy_id || null,
                allow_proxy_failover: !!allow_proxy_failover,
                failover_proxy_ids: normalizedPool
            }).eq('id', account_id).eq('owner_id', req.user.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ==========================================
    // 2. ИМПОРТ ФАЙЛА СЕССИИ (.SESSION / SQLITE)
    // ==========================================
    router.post('/import-session-file', authenticateUser, upload.fields([
        { name: 'sessionFile', maxCount: 1 },
        { name: 'jsonFile', maxCount: 1 }
    ]), async (req, res) => {
        const uploadedFiles = [
            ...(req.files?.sessionFile || []),
            ...(req.files?.jsonFile || [])
        ];

        try {
            const sessionFile = req.files?.sessionFile?.[0];
            const jsonFile = req.files?.jsonFile?.[0];

            if (!sessionFile) return res.status(400).json({ error: 'Загрузи именно `.session` файл. Папки `tdata`, архивы и другие форматы здесь не поддержаны.' });
            const { proxy_id } = req.body;

            if (!jsonFile) {
                return res.status(400).json({ error: 'Для безопасного импорта нужен и `.json` с fingerprint. Без него аккаунт остаётся в risk-case по device/app mismatch.' });
            }

            await userbotService.validateSessionSqliteFile(sessionFile.path);
            const fingerprint = await userbotService.validateConfigJsonFile(jsonFile.path);

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота можно импортировать только через прокси. Сначала выбери живой прокси.' });
            }

            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }

            let proxyData = null;
            const data = await loadOwnedProxy(supabase, req.user.id, proxy_id);
            if (data) {
                proxyData = {
                    proxy_host: data.host,
                    proxy_port: data.port,
                    proxy_username: data.username,
                    proxy_password: data.password,
                    proxy_id: data.id,
                    is_working: data.is_working,
                    last_check_ip: data.last_check_ip,
                    last_check_country: data.last_check_country,
                    last_check_city: data.last_check_city,
                    force_ipv6: data.is_working === true && (!data.last_check_ip || data.last_check_ip.includes(':')),
                    provision_source: data.provision_source,
                    inventory_group: data.inventory_group
                };
            }
            if (!proxyData) {
                return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
            }
            if (data.is_working === false) {
                return res.status(400).json({ error: 'Этот прокси уже помечен как мертвый. Сначала почини его или выбери другой.' });
            }

            const sessionString = await userbotService.extractSessionFromSqlite(sessionFile.path);

            const proxyConfig = userbotService._buildProxy(proxyData);
            const clientConfig = userbotService._getClientConfig(proxyConfig, 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(sessionString), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            try {
                await userbotService.connectWithProxyFallback(client, proxyData);

                const me = await client.getMe();
                let existingAccountId = null;

                const { data: existingAccount } = await supabase
                    .from('tg_accounts')
                    .select('id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .eq('tg_account_id', me.id.toString())
                    .maybeSingle();

                existingAccountId = existingAccount?.id || null;
                await enforceUserbotQuota({
                    supabase,
                    ownerId: req.user.id,
                    profile: req.profile,
                    ignoreAccountId: existingAccountId
                });
                await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), existingAccountId);
                await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id, existingAccountId);

                await supabase.from('tg_accounts').upsert({
                    owner_id: req.user.id,
                    account_type: 'userbot',
                    ...buildTelegramProfilePatch(me),
                    session_data: encrypt(userbotService.stringifySessionData(client.session.save(), fingerprint, 'session_import')),
                    proxy_id: proxyData ? proxyData.proxy_id : null,
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                    allow_proxy_failover: false,
                    failover_proxy_ids: []
                }, { onConflict: 'owner_id, tg_account_id' }).select('id').single();

                const { data: savedAccount } = await supabase
                    .from('tg_accounts')
                    .select('id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .eq('tg_account_id', me.id.toString())
                    .maybeSingle();

                if (savedAccount?.id) {
                    try {
                        if (shouldStoreRecoverySource(req.body?.save_recovery_source)) {
                            await userbotService.saveRecoverySource({
                                accountId: savedAccount.id,
                                ownerId: req.user.id,
                                tgAccountId: me.id.toString(),
                                sessionFilePath: sessionFile.path,
                                sessionOriginalName: sessionFile.originalname,
                                jsonFilePath: jsonFile?.path || null,
                                jsonOriginalName: jsonFile?.originalname || null,
                                fingerprint
                            });
                        }
                    } catch (restoreError) {
                        if (!isMissingRecoveryTable(restoreError)) {
                            throw restoreError;
                        }
                    }
                }

                cleanupUploadedFiles(uploadedFiles);

                res.json({
                    success: true,
                    username: me.username || me.firstName,
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_reason: FRESH_IMPORT_RUNTIME_REASON,
                    recovery_source_saved: shouldStoreRecoverySource(req.body?.save_recovery_source)
                });
            } finally {
                if (client) {
                    try {
                        await client.disconnect();
                    } catch {
                        // no-op
                    }
                }
            }

        } catch (error) {
            cleanupUploadedFiles(uploadedFiles);
            console.error('[USERBOT_IMPORT] failed:', error?.message || error);
            const sanitized = sanitizeUserbotImportError(error);
            res.status(sanitized.statusCode).json({ error: sanitized.message });
        }
    });

    // ==========================================
    // 2б. ПРИЁМКА ПАЧЕК АККАУНТОВ (account shop intake)
    // Платформенный админ грузит zip/папки с комплектами
    // (<phone>.session + <phone>.json + tdata + заметка с паролем 2FA).
    // Без Telegram: валидация, managed-прокси, safe-mode, blob'ы восстановления.
    // Прогресс — в account_import_batches (миграция backend/sql/account-shop-intake.sql).
    // ==========================================

    // Зависшие «processing» — обработка жила в памяти и умерла вместе с
    // перезапуском сервера. Честно помечаем такие батчи упавшими. Зовём из
    // обоих GET, чтобы поллинг одиночной пачки тоже видел честный статус.
    async function sweepStaleIntakeBatches(ownerId) {
        const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await supabase
            .from('account_import_batches')
            .update({ status: 'failed', error: 'Прерван перезапуском сервера.', updated_at: new Date().toISOString() })
            .eq('owner_id', ownerId)
            .eq('status', 'processing')
            .lt('updated_at', staleBefore);
    }

    router.post('/intake/batch', authenticateUser, intakeUpload.fields([
        { name: 'files', maxCount: 400 }
    ]), async (req, res) => {
        const uploadedFiles = req.files?.files || [];
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Приёмка пачек доступна только платформенному админу.' });
            }

            const files = req.files?.files || [];
            if (!files.length) {
                return res.status(400).json({ error: 'Загрузи zip или файлы пачек: .session + .json, опционально папки tdata и заметка с паролем.' });
            }

            let relPaths = [];
            if (req.body?.paths) {
                try {
                    relPaths = JSON.parse(req.body.paths);
                } catch {
                    return res.status(400).json({ error: 'Поле paths должно быть JSON-массивом относительных путей файлов.' });
                }
            }
            if (!Array.isArray(relPaths)) {
                return res.status(400).json({ error: 'Поле paths должно быть JSON-массивом относительных путей файлов.' });
            }

            let entries;
            try {
                entries = await normalizeEntries(files, relPaths);
            } catch (sizeError) {
                return res.status(400).json({ error: sizeError?.message || 'Не удалось прочитать загруженные файлы.' });
            }
            let expanded;
            try {
                expanded = unpackZipEntries(entries);
            } catch (zipError) {
                return res.status(400).json({ error: zipError?.message || 'Не удалось распаковать загруженные архивы.' });
            }

            const { packs, rejects } = groupAccountPacks(expanded);
            if (!packs.length) {
                return res.status(400).json({
                    error: 'В загрузке не нашлось ни одной полной пачки (.session + .json). Проверь состав файлов.',
                    rejects
                });
            }

            if (packs.length > MAX_INTAKE_BATCH) {
                return res.status(403).json({
                    error: `За одну приёмку нельзя принять больше ${MAX_INTAKE_BATCH} аккаунтов. Разбей загрузку на части.`,
                    total: packs.length
                });
            }

            // Ёмкость managed-прокси — те же лимиты, что у ручной выдачи админу.
            const managedSummary = managedProxyService.getStateSummary();
            if (Number(managedSummary.total || 0) + packs.length > MAX_MANAGED_PROXIES_GLOBAL) {
                const freeSlots = Math.max(0, MAX_MANAGED_PROXIES_GLOBAL - Number(managedSummary.total || 0));
                return res.status(403).json({
                    error: `На сервере лимит managed-прокси (${MAX_MANAGED_PROXIES_GLOBAL}). Свободно слотов: ${freeSlots}.`
                });
            }

            const { count: ownerManagedCount, error: ownerCountError } = await supabase
                .from('proxies')
                .select('*', { count: 'exact', head: true })
                .eq('owner_id', req.user.id)
                .eq('provision_source', 'manual_admin');
            if (ownerCountError) throw ownerCountError;

            if (Number(ownerManagedCount || 0) + packs.length > MAX_MANAGED_PROXIES_PER_ADMIN) {
                const freeSlots = Math.max(0, MAX_MANAGED_PROXIES_PER_ADMIN - Number(ownerManagedCount || 0));
                return res.status(403).json({
                    error: `У одного админа нельзя держать больше ${MAX_MANAGED_PROXIES_PER_ADMIN} серверных прокси. Свободно слотов: ${freeSlots}.`
                });
            }

            const items = packs.map((pack) => ({ key: pack.key, label: pack.label, status: 'queued' }));
            const { data: batchRow, error: batchError } = await supabase
                .from('account_import_batches')
                .insert({
                    owner_id: req.user.id,
                    status: 'processing',
                    total: packs.length,
                    processed: 0,
                    failed: 0,
                    items
                })
                .select('id')
                .single();
            if (batchError || !batchRow?.id) {
                throw new Error(`Не удалось создать журнал приёмки: ${batchError?.message || 'пустой ответ'}. Проверь, что применена миграция backend/sql/account-shop-intake.sql.`);
            }

            // Файлы уже прочитаны в память — временные копии можно удалять.
            cleanupUploadedFiles(uploadedFiles);

            // Fire-and-forget: роут отвечает сразу, прогресс пишется в строку батча
            // после каждого айтема — UI поллит GET /intake/batch/:id. Страховочный
            // catch — на случай, если внутренний предохранитель сам упадёт.
            processIntakeBatch({
                supabase,
                userbotService,
                managedProxyService,
                ownerId: req.user.id,
                batchId: batchRow.id,
                packs,
                items,
                launchVerification: (proxy) => launchManagedProxyVerification({
                    supabase,
                    userbotService,
                    ownerId: req.user.id,
                    proxyId: proxy.id,
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username,
                    password: proxy.password
                })
            }).catch((runError) => {
                console.error('[USERBOT_INTAKE] batch crashed:', runError?.message || runError);
            });

            return res.json({
                success: true,
                batch_id: batchRow.id,
                total: packs.length,
                rejected: rejects
            });
        } catch (error) {
            console.error('[USERBOT_INTAKE] failed:', error?.message || error);
            return res.status(500).json({ error: error?.message || 'Приёмка не прошла. Попробуй еще раз.' });
        } finally {
            cleanupUploadedFiles(uploadedFiles);
        }
    });

    router.get('/intake/batches', authenticateUser, async (req, res) => {
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Приёмка пачек доступна только платформенному админу.' });
            }

            // Зависшие «processing» — см. sweepStaleIntakeBatches.
            await sweepStaleIntakeBatches(req.user.id);

            const { data, error } = await supabase
                .from('account_import_batches')
                .select('id, status, total, processed, failed, error, created_at, updated_at')
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false })
                .limit(20);
            if (error) throw error;

            return res.json({ batches: data || [] });
        } catch (error) {
            console.error('[USERBOT_INTAKE] batches failed:', error?.message || error);
            return res.status(500).json({ error: 'Не удалось загрузить журнал приёмки.' });
        }
    });

    router.get('/intake/batch/:id', authenticateUser, async (req, res) => {
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Приёмка пачек доступна только платформенному админу.' });
            }

            await sweepStaleIntakeBatches(req.user.id);

            const { data, error } = await supabase
                .from('account_import_batches')
                .select('*')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Партия приёмки не найдена.' });

            return res.json({ batch: data });
        } catch (error) {
            console.error('[USERBOT_INTAKE] batch failed:', error?.message || error);
            return res.status(500).json({ error: 'Не удалось загрузить партию приёмки.' });
        }
    });

    // ==========================================
    // 3. ГЕНЕРАЦИЯ QR (Классический метод)
    // ==========================================
    router.get('/fingerprint-profiles', authenticateUser, async (req, res) => {
        try {
            const profiles = await userbotService.listQrFingerprintProfiles(req.user.id);
            res.json({ profiles });
        } catch (error) {
            console.error('[USERBOT_FINGERPRINT_PROFILES] failed:', error?.message || error);
            res.status(500).json({ error: 'Не удалось загрузить fingerprint-пресеты.' });
        }
    });

    router.post('/qr-start', authenticateUser, async (req, res) => {
        try {
            await userbotService.sweepStaleQrSessions();

            const { proxy_id, fingerprint_profile_id, custom_fingerprint, save_as_preset } = req.body;
            const normalizedCustomFingerprint = custom_fingerprint ? normalizeFingerprintPayload(custom_fingerprint) : null;

            if (normalizedCustomFingerprint) {
                validateCustomFingerprintPayload(normalizedCustomFingerprint);
            }

            console.log(
                '[QR-ROUTE] Начинаем генерацию QR, proxy_id:',
                proxy_id,
                'fingerprint_profile_id:',
                fingerprint_profile_id || 'default',
                'custom_fingerprint:',
                normalizedCustomFingerprint ? normalizedCustomFingerprint.label || 'custom' : 'none',
                'save_as_preset:',
                !!save_as_preset
            );

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота можно подключать только через прокси. Сначала выбери живой прокси.' });
            }

            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }

            let proxyData = null;
            const data = await loadOwnedProxy(supabase, req.user.id, proxy_id);
            if (data) {
                proxyData = {
                    proxy_host: data.host,
                    proxy_port: data.port,
                    proxy_username: data.username,
                    proxy_password: data.password,
                    proxy_id: data.id,
                    is_working: data.is_working,
                    last_check_ip: data.last_check_ip,
                    last_check_country: data.last_check_country,
                    last_check_city: data.last_check_city,
                    force_ipv6: data.is_working === true && (!data.last_check_ip || data.last_check_ip.includes(':')),
                    provision_source: data.provision_source,
                    inventory_group: data.inventory_group
                };
                console.log('[QR-ROUTE] Прокси найден:', proxyData.proxy_host, ':', proxyData.proxy_port);
                if (data.is_working === false) {
                    return res.status(400).json({ error: 'Этот прокси уже помечен как мертвый. Сначала почини его или выбери другой.' });
                }
                await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id);
            } else {
                console.log('[QR-ROUTE] Прокси с ID', proxy_id, 'не найден в БД');
                return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
            }

            const result = await userbotService.generateQR(req.user.id, proxyData, {
                profile_id: fingerprint_profile_id,
                custom_fingerprint: normalizedCustomFingerprint,
                save_as_preset: !!save_as_preset,
                preset_label: normalizedCustomFingerprint?.label || ''
            }, req.user.id);
            console.log('[QR-ROUTE] QR-сессия запущена, генерация идет в фоне');
            res.json(result);
        } catch (error) {
            console.error('[QR-ROUTE] ❌ ОШИБКА при генерации QR:', error.message);
            const statusCode = String(error.message || '').includes('только через прокси') ? 400 : 500;
            res.status(statusCode).json({
                error: statusCode === 400
                    ? (error.message || 'Ошибка инициализации клиента')
                    : 'Не удалось подготовить QR-вход. Проверь прокси и попробуй еще раз.'
            });
        }
    });

    router.get('/qr-status', authenticateUser, async (req, res) => {
        await userbotService.sweepStaleQrSessions();

        const sessionData = userbotService.qrSessions.get(req.user.id);
        if (!sessionData) return res.status(404).json({ status: 'not_found' });

        try {
            if (sessionData.authState === 'failed') {
                return res.json({
                    status: 'failed',
                    error: sessionData.authError || 'QR-вход не прошел. Сгенерируй QR заново.'
                });
            }
            if (sessionData.authState === '2fa_required') {
                // Скан принят, Telegram ждет auth.checkPassword — фронт покажет
                // форму облачного пароля, ответ придет в POST /qr-password.
                const gate = sessionData.passwordGate;
                return res.json({
                    status: '2fa_required',
                    password_hint: gate?.getHint() || '',
                    password_error: gate?.getError() || null
                });
            }
            if (sessionData.authState !== 'authorized') {
                if (!sessionData.currentQrCode) {
                    // Клиент еще поднимается через прокси, первого токена нет.
                    return res.json({ status: 'generating' });
                }
                // Токен QR ротируется каждые ~30с: отдаём свежую картинку,
                // фронт подменяет QR на экране, пока владелец ещё не отсканил.
                return res.json({ status: 'pending', qr_code: sessionData.currentQrCode });
            }

            const savedSession = sessionData.client?.session?.save?.() || '';
            if (savedSession === '') {
                return res.json({ status: 'pending' });
            }

            const token = savedSession;
            const me = await sessionData.client.getMe();
            let existingAccountId = null;

            const { data: existingAccount } = await supabase
                .from('tg_accounts')
                .select('id')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .eq('tg_account_id', me.id.toString())
                .maybeSingle();

            existingAccountId = existingAccount?.id || null;
            await enforceUserbotQuota({
                supabase,
                ownerId: req.user.id,
                profile: req.profile,
                ignoreAccountId: existingAccountId
            });
            await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), existingAccountId);
            if (sessionData.proxyData?.proxy_id) {
                await ensureExclusiveProxyAssignment(supabase, req.user.id, sessionData.proxyData.proxy_id, existingAccountId);
            }

            await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'userbot',
                ...buildTelegramProfilePatch(me),
                session_data: encrypt(userbotService.stringifySessionData(token, sessionData.fingerprint, 'qr')),
                proxy_id: sessionData.proxyData ? sessionData.proxyData.proxy_id : null,
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            }, { onConflict: 'owner_id, tg_account_id' });

            await sessionData.client.disconnect();
            userbotService.qrSessions.delete(req.user.id);
            return res.json({
                status: 'success',
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_reason: FRESH_IMPORT_RUNTIME_REASON,
                fingerprint_profile_id: sessionData.fingerprint?.profileId || null,
                fingerprint_profile_label: sessionData.fingerprint?.profileLabel || null
            });
        } catch (error) {
            const raw = String(error?.errorMessage || error?.message || error || '');
            console.error('[QR-STATUS] failed:', raw);

            if (
                isExpiredUserbotSessionError(error)
                || raw.includes('Cannot send requests while disconnected')
                || raw.includes('TIMEOUT')
                || raw.includes('timed out')
            ) {
                return res.json({ status: 'pending' });
            }

            return res.status(500).json({ error: 'Не удалось проверить статус QR-входа. Попробуй сгенерировать QR заново.' });
        }
    });

    // Облачный пароль (2FA) для QR-входа: скан уже принят, авторизация
    // запаркована на гейте — отдаем пароль в signInWithPassword.
    router.post('/qr-password', authenticateUser, async (req, res) => {
        await userbotService.sweepStaleQrSessions();

        const sessionData = userbotService.qrSessions.get(req.user.id);
        if (!sessionData || sessionData.authState !== '2fa_required') {
            return res.status(404).json({
                error: 'Нет активного запроса пароля. Отсканируй QR — Telegram сам попросит пароль, если он нужен.'
            });
        }

        const password = String(req.body?.password || '').trim();
        if (!password) {
            return res.status(400).json({ error: 'Введи облачный пароль (2FA) этого аккаунта.' });
        }

        const accepted = sessionData.passwordGate?.submit(password);
        if (!accepted) {
            return res.status(409).json({ error: 'Пароль уже принят, ждем ответ Telegram.' });
        }

        sessionData.authState = 'pending';
        return res.json({ status: 'checking' });
    });

    // ==========================================
    // 4. УДАЛЕНИЕ И ПРОВЕРКА АККАУНТОВ
    // ==========================================
    router.post('/profile/:id/sync', authenticateUser, async (req, res) => {
        const accountId = req.params.id;
        let client = null;

        try {
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден.' });
            }
            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Профиль так обновляем только у юзерботов.' });
            }
            if (isFreshImportedUserbot(account)) {
                return res.status(409).json({ error: 'Аккаунт в safe-mode. Сначала сделай живую активацию через проверку Telegram.' });
            }
            if (isUserbotOnDeadProxy(account)) {
                return res.status(409).json({ error: 'У юзербота мертвый прокси. Сначала почини или смени прокси.' });
            }

            const cooldown = userbotProfileSyncCooldown(account);
            if (cooldown) {
                return res.json({
                    success: true,
                    cached: true,
                    cooldown,
                    account,
                    message: `Профиль уже обновляли недавно. Повторить можно примерно через ${Math.ceil(cooldown.retry_after_seconds / 60)} мин.`
                });
            }

            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                throw new Error('Сессия не читается или уже недействительна.');
            }

            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
            const proxyData = account.proxies
                ? {
                    proxy_host: account.proxies.host,
                    proxy_port: account.proxies.port,
                    proxy_username: account.proxies.username,
                    proxy_password: account.proxies.password
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const me = await client.getMe();
            let about = null;
            let photoUrl;

            try {
                const fullUser = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = String(fullUser?.fullUser?.about || '').trim() || null;
            } catch (profileError) {
                console.warn('[USERBOT_PROFILE_SYNC] about skipped:', profileError?.message || profileError);
            }

            try {
                const photo = await client.downloadProfilePhoto(me, { isBig: false });
                if (Buffer.isBuffer(photo) && photo.length > 0) {
                    photoUrl = storeUserbotProfilePhoto({
                        ownerId: req.user.id,
                        accountId: account.id,
                        photo
                    });
                } else if (Buffer.isBuffer(photo)) {
                    photoUrl = null;
                }
            } catch (photoError) {
                console.warn('[USERBOT_PROFILE_SYNC] photo skipped:', photoError?.message || photoError);
            }

            const syncedAt = new Date().toISOString();
            const patch = {
                ...buildTelegramProfilePatch(me, {
                    tg_about: about,
                    tg_profile_synced_at: syncedAt,
                    tg_profile_sync_attempted_at: syncedAt,
                    ...(photoUrl !== undefined ? { tg_photo_url: photoUrl, tg_photo_synced_at: syncedAt, tg_photo_data_url: null } : {}),
                    tg_profile_sync_error: null
                })
            };

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update(patch)
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('*')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Профиль не сохранился.');
            }

            return res.json({
                success: true,
                cached: false,
                account: updatedAccount,
                message: 'Профиль юзербота обновлен.'
            });
        } catch (error) {
            console.error('[USERBOT_PROFILE_SYNC] failed', {
                accountId,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            try {
                await supabase
                    .from('tg_accounts')
                    .update({
                        tg_profile_sync_error: error.message || 'Не удалось обновить профиль.',
                        tg_profile_sync_attempted_at: new Date().toISOString()
                    })
                    .eq('id', accountId)
                    .eq('owner_id', req.user.id);
            } catch (updateError) {
                console.error('[USERBOT_PROFILE_SYNC] error marker failed:', updateError?.message || updateError);
            }
            return res.status(500).json({ error: error.message || 'Не удалось обновить профиль.' });
        } finally {
            if (client) {
                try {
                    await client.disconnect();
                } catch {
                    // no-op
                }
            }
        }
    });

    router.post('/profile/:id/update', authenticateUser, async (req, res) => {
        const accountId = req.params.id;
        let client = null;

        try {
            const input = normalizeEditableTelegramProfile(req.body || {});
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден.' });
            }
            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Профиль так меняем только у юзерботов.' });
            }
            if (isFreshImportedUserbot(account)) {
                return res.status(409).json({ error: 'Аккаунт в safe-mode. Сначала сделай живую активацию через проверку Telegram.' });
            }
            if (isUserbotOnDeadProxy(account)) {
                return res.status(409).json({ error: 'У юзербота мертвый прокси. Сначала почини или смени прокси.' });
            }

            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                throw new Error('Сессия не читается или уже недействительна.');
            }

            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
            const proxyData = account.proxies
                ? {
                    proxy_host: account.proxies.host,
                    proxy_port: account.proxies.port,
                    proxy_username: account.proxies.username,
                    proxy_password: account.proxies.password
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            await client.invoke(new Api.account.UpdateProfile({
                firstName: input.firstName,
                lastName: input.lastName,
                about: input.about
            }));

            const me = await client.getMe();
            let about = input.about || null;
            try {
                const fullUser = await client.invoke(new Api.users.GetFullUser({ id: 'me' }));
                about = String(fullUser?.fullUser?.about ?? input.about ?? '').trim() || null;
            } catch (profileError) {
                console.warn('[USERBOT_PROFILE_UPDATE] about verify skipped:', profileError?.message || profileError);
            }

            const syncedAt = new Date().toISOString();
            const patch = buildTelegramProfilePatch(me, {
                tg_first_name: input.firstName,
                tg_last_name: input.lastName || null,
                tg_about: about,
                tg_profile_synced_at: syncedAt,
                tg_profile_sync_attempted_at: syncedAt,
                tg_profile_sync_error: null
            });

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update(patch)
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('*')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Профиль изменился в Telegram, но не сохранился в БД.');
            }

            return res.json({
                success: true,
                account: updatedAccount,
                message: 'Профиль сохранен в Telegram и Supabase.'
            });
        } catch (error) {
            console.error('[USERBOT_PROFILE_UPDATE] failed', {
                accountId,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            try {
                await supabase
                    .from('tg_accounts')
                    .update({
                        tg_profile_sync_error: error.message || 'Не удалось сохранить профиль.',
                        tg_profile_sync_attempted_at: new Date().toISOString()
                    })
                    .eq('id', accountId)
                    .eq('owner_id', req.user.id);
            } catch (updateError) {
                console.error('[USERBOT_PROFILE_UPDATE] error marker failed:', updateError?.message || updateError);
            }
            return res.status(500).json({ error: error.message || 'Не удалось сохранить профиль.' });
        } finally {
            if (client) {
                try {
                    await client.disconnect();
                } catch {
                    // no-op
                }
            }
        }
    });

    router.delete('/:id', authenticateUser, async (req, res) => {
        try {
            try {
                await userbotService.deleteRecoverySource(req.user.id, req.params.id);
            } catch (error) {
                if (!isMissingRecoveryTable(error)) {
                    throw error;
                }
            }
            await supabase.from('tg_accounts').delete().eq('id', req.params.id).eq('owner_id', req.user.id);
            res.status(200).json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Ошибка при удалении' }); }
    });

    router.get('/recovery-status', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('userbot_restore_sources')
                .select('account_id, source_type, session_filename, json_filename, updated_at, last_restored_at, last_restore_status, last_restore_error, intake_batch_id')
                .eq('owner_id', req.user.id);

            if (error) {
                if (isMissingRecoveryTable(error)) {
                    return res.json({ support: { recovery: false }, rows: [] });
                }
                throw error;
            }

            res.json({
                support: { recovery: true },
                rows: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Ошибка загрузки recovery status' });
        }
    });

    router.post('/restore/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (!account) return res.status(404).json({ error: 'Юзербот не найден' });

            const activateNow = String(req.body?.activate_now || '').trim().toLowerCase() === 'true';
            let targetAccount = account;
            if (isUserbotOnDeadProxy(account)) {
                const failover = await userbotService.tryAutoFailoverUserbot(account);
                if (failover.switched) {
                    targetAccount = failover.account;
                } else if (failover.reason === 'cooldown') {
                    return res.status(409).json({ error: getFailoverCooldownMessage(failover.retry_after_ms) });
                } else {
                    return res.status(409).json({ error: getDeadProxyMessage() });
                }
            }

            let restoreSource;
            try {
                restoreSource = await userbotService.getRecoverySource(req.user.id, targetAccount.id);
            } catch (restoreError) {
                if (isMissingRecoveryTable(restoreError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под session recovery foundation.' });
                }
                throw restoreError;
            }

            if (!restoreSource?.session_blob_encrypted) {
                return res.status(404).json({ error: 'Для этого юзербота нет сохраненного restore source. Нужен новый импорт .session/.json.' });
            }

            const sessionBuffer = Buffer.from(decrypt(restoreSource.session_blob_encrypted), 'base64');
            const sessionString = await userbotService.extractSessionFromSqliteBuffer(sessionBuffer);

            let fingerprint = userbotService.getDefaultFingerprint();
            if (restoreSource.json_blob_encrypted) {
                try {
                    fingerprint = userbotService.parseConfigJsonContent(decrypt(restoreSource.json_blob_encrypted));
                } catch {}
            } else if (restoreSource.fingerprint) {
                fingerprint = userbotService._normalizeFingerprint(restoreSource.fingerprint);
            } else if (targetAccount.session_data) {
                const parsed = userbotService.parseSessionData(decrypt(targetAccount.session_data));
                fingerprint = parsed.fingerprint;
            }

            const proxyData = targetAccount.proxies
                ? {
                    proxy_host: targetAccount.proxies.host,
                    proxy_port: targetAccount.proxies.port,
                    proxy_username: targetAccount.proxies.username,
                    proxy_password: targetAccount.proxies.password,
                    provision_source: targetAccount.proxies.provision_source,
                    inventory_group: targetAccount.proxies.inventory_group
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(sessionString), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);

            try {
                await userbotService.connectWithProxyFallback(client, proxyData);
                const me = await client.getMe();

                await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), targetAccount.id);
                if (targetAccount.proxy_id) {
                    await ensureExclusiveProxyAssignment(supabase, req.user.id, targetAccount.proxy_id, targetAccount.id);
                }

                await supabase
                    .from('tg_accounts')
                    .update({
                        ...buildTelegramProfilePatch(me),
                        session_data: encrypt(userbotService.stringifySessionData(client.session.save(), fingerprint, 'restored')),
                        runtime_status: activateNow ? 'online' : FRESH_IMPORT_RUNTIME_STATUS,
                        runtime_error: activateNow ? null : FRESH_IMPORT_RUNTIME_REASON,
                        allow_proxy_failover: false,
                        failover_proxy_ids: [],
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                await supabase
                    .from('userbot_restore_sources')
                    .update({
                        tg_account_id: me.id.toString(),
                        last_restored_at: new Date().toISOString(),
                        last_restore_status: 'restored',
                        last_restore_error: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                res.json({
                    success: true,
                    username: me.username || me.firstName,
                    tg_account_id: me.id.toString(),
                    runtime_status: activateNow ? 'online' : FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_reason: activateNow ? null : FRESH_IMPORT_RUNTIME_REASON
                });
            } catch (error) {
                await supabase
                    .from('userbot_restore_sources')
                    .update({
                        last_restore_status: 'failed',
                        last_restore_error: error.message || 'restore_failed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                throw error;
            } finally {
                try { await client.disconnect(); } catch {}
            }
        } catch (error) {
            console.error('Ошибка восстановления юзербота:', error?.message || error);
            const sanitized = sanitizeUserbotImportError(error);
            res.status(sanitized.statusCode).json({
                error: sanitized.statusCode === 500
                    ? 'Восстановление из сохраненного комплекта не прошло. Проверь источник и прокси, затем повтори.'
                    : sanitized.message
            });
        }
    });

    router.post('/safe-mode/:id', authenticateUser, async (req, res) => {
        try {
            const enabled = req.body?.enabled === true;
            console.log('[USERBOT_SAFE_MODE] request', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                enabled
            });
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, runtime_status')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден' });
            }

            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Safe-mode работает только для юзерботов.' });
            }

            if (enabled !== true) {
                return res.status(400).json({ error: 'Выключение safe-mode делается через живую Telegram-проверку.' });
            }

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_error: FRESH_IMPORT_RUNTIME_REASON
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, runtime_status, runtime_error')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Safe-mode update не сохранился.');
            }

            console.log('[USERBOT_SAFE_MODE] switched', {
                accountId: updatedAccount.id,
                ownerId: req.user?.id || null,
                prevStatus: account.runtime_status || null,
                nextStatus: updatedAccount.runtime_status || null
            });

            return res.json({
                success: true,
                runtime_status: updatedAccount.runtime_status || null,
                runtime_reason: updatedAccount.runtime_error || null
            });
        } catch (error) {
            console.error('[USERBOT_SAFE_MODE] failed', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                error: error.message || String(error || '')
            });
            res.status(500).json({ error: error.message || 'Не удалось переключить safe-mode.' });
        }
    });

    router.patch('/custom-label/:id', authenticateUser, async (req, res) => {
        try {
            const raw = typeof req.body?.custom_label === 'string' ? req.body.custom_label.trim() : '';
            const custom_label = raw.slice(0, 100) || null;

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (accountError || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден' });
            }

            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Метку можно поставить только юзерботу.' });
            }

            const { data: updated, error: updateError } = await supabase
                .from('tg_accounts')
                .update({ custom_label })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, custom_label')
                .single();

            if (updateError || !updated) {
                throw new Error(updateError?.message || 'Метка не сохранилась.');
            }

            return res.json({ success: true, custom_label: updated.custom_label || '' });
        } catch (error) {
            console.error('[USERBOT_CUSTOM_LABEL] failed', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            res.status(500).json({ error: error.message || 'Не удалось сохранить метку.' });
        }
    });

    router.get('/check/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase.from('tg_accounts').select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)').eq('id', req.params.id).eq('owner_id', req.user.id).single();
            if (!account) return res.status(404).json({ error: 'Аккаунт не найден' });
            const activate = String(req.query.activate || '').trim().toLowerCase() === 'true';
            console.log('[USERBOT_CHECK] request', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                activate,
                runtimeStatus: account.runtime_status || null
            });
            if (isFreshImportedUserbot(account) && activate !== true) {
                return res.status(409).json({
                    status: FRESH_IMPORT_RUNTIME_STATUS,
                    reason: `${FRESH_IMPORT_RUNTIME_REASON} Нажми отдельную живую проверку с подтверждением, чтобы активировать аккаунт.`
                });
            }
            if (isUserbotOnDeadProxy(account)) {
                const failover = await userbotService.tryAutoFailoverUserbot(account);
                if (failover.switched) {
                    await supabase.from('tg_accounts').update({
                        runtime_status: 'online',
                        runtime_error: null,
                        last_checked_at: new Date().toISOString()
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    console.log('[USERBOT_CHECK] failover_switched', {
                        accountId: account.id,
                        ownerId: req.user?.id || null,
                        nextStatus: 'online',
                        proxyId: failover.to_proxy_id
                    });
                    return res.json(buildCheckResponse(
                        'online',
                        'Сессия отвечает. Прокси был автоматически переключен на живой.',
                        {
                            session: 'alive',
                            restriction: 'clear',
                            restriction_reason: '',
                            spambot: {
                                state: 'not_checked',
                                reason: '',
                                source: 'failover_only'
                            }
                        },
                        { failover_switched: true, proxy_id: failover.to_proxy_id }
                    ));
                }
                await supabase.from('tg_accounts').update({
                    runtime_status: 'dead_proxy',
                    runtime_error: 'У юзербота мертвый прокси.',
                    last_checked_at: new Date().toISOString()
                }).eq('id', account.id).eq('owner_id', req.user.id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'dead_proxy',
                    severity: 'danger',
                    error_message: 'У юзербота мертвый прокси.',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                return res.json(buildCheckResponse(
                    'inactive_proxy',
                    'У юзербота мертвый прокси.',
                    {
                        session: 'unknown',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'proxy_dead'
                        }
                    }
                ));
            }
            const checkedAt = new Date().toISOString();
            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                await supabase.from('tg_accounts').update({
                    runtime_status: 'expired',
                    runtime_error: 'Сессия не читается или уже недействительна.',
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'session_revoked',
                    severity: 'danger',
                    is_restriction: true,
                    error_message: 'Сессия не читается или уже недействительна.',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                return res.json(buildCheckResponse(
                    'expired',
                    'Сессия не читается или уже недействительна.',
                    {
                        session: 'dead',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'session_invalid'
                        }
                    }
                ));
            }
            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);

            if (account.account_type === 'bot') {
                try {
                    const botToken = String(token || decryptedData || '').trim();
                    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
                    const data = await response.json();
                    const status = data.ok ? 'online' : 'expired';
                    await supabase.from('tg_accounts').update({
                        runtime_status: status,
                        runtime_error: data.ok ? null : 'Telegram не подтвердил токен official-бота.',
                        last_checked_at: checkedAt
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    return res.json(buildCheckResponse(status, data.ok ? 'Official-бот отвечает.' : 'Telegram не подтвердил токен official-бота.'));
                } catch (e) {
                    await supabase.from('tg_accounts').update({
                        runtime_status: 'expired',
                        runtime_error: 'Telegram не ответил на проверку official-бота.',
                        last_checked_at: checkedAt
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    return res.json(buildCheckResponse('expired', 'Telegram не ответил на проверку official-бота.'));
                }
            }

            const proxyData = account.proxies ? { proxy_host: account.proxies.host, proxy_port: account.proxies.port, proxy_username: account.proxies.username, proxy_password: account.proxies.password } : undefined;
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            let connectOk = false;
            let getMeOk = false;
            try {
                console.log('[USERBOT_CHECK] connect_start', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    proxy: proxyData?.proxy_host && proxyData?.proxy_port
                        ? `${proxyData.proxy_host}:${proxyData.proxy_port}`
                        : null
                });
                await withTimeout(
                    userbotService.connectWithProxyFallback(client, proxyData),
                    USERBOT_HEALTH_CONNECT_TIMEOUT_MS,
                    'Telegram не ответил на подключение за отведенное время. Проверь прокси и повтори проверку.'
                );
                connectOk = true;
                console.log('[USERBOT_CHECK] connect_ok', {
                    accountId: account.id,
                    ownerId: req.user?.id || null
                });
                await withTimeout(
                    client.getMe(),
                    USERBOT_HEALTH_INSPECT_TIMEOUT_MS,
                    'Telegram не отдал профиль аккаунта за отведенное время.'
                );
                getMeOk = true;
                console.log('[USERBOT_CHECK] get_me_ok', {
                    accountId: account.id,
                    ownerId: req.user?.id || null
                });
                const health = await withTimeout(
                    userbotService.inspectAccountHealth(client, {
                        userbotId: account.id
                    }),
                    USERBOT_HEALTH_INSPECT_TIMEOUT_MS,
                    'Telegram health-check завис на SpamBot/profile check. Проверь прокси и повтори проверку.'
                );
                await supabase.from('tg_accounts').update({
                    runtime_status: health.status || 'error',
                    runtime_error: health.reason || null,
                    last_checked_at: checkedAt,
                    health_summary: buildHealthSummary(health, checkedAt)
                }).eq('id', account.id).eq('owner_id', req.user.id);
                console.log('[USERBOT_CHECK] result', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    nextStatus: health.status || 'error',
                    reason: health.reason || null
                });
                if (String(health.status || '') === 'restricted') {
                    await unpublishRestrictedUserbotListings(supabase, req.user.id, account.id, health.reason || 'account_restricted');
                    await cleanupRestrictedUserbotProxy(supabase, managedProxyService, req.user.id, account);
                }
                // Заморозка: аккаунт жив, сессия нужна для апелляции — снимаем с
                // витрины, но прокси и аккаунт не трогаем (пуржа для frozen нет).
                if (String(health.status || '') === 'frozen') {
                    await unpublishRestrictedUserbotListings(supabase, req.user.id, account.id, health.reason || 'account_frozen');
                }
                res.json(buildCheckResponse(
                    health.status,
                    health.reason || null,
                    health.details || null
                ));
                if (['restricted', 'expired', 'error', 'frozen'].includes(String(health.status || ''))) {
                    await logTelegramErrorEvent(supabase, {
                        owner_id: req.user.id,
                        userbot_id: account.id,
                        event_source: 'userbot_health',
                        event_type: 'health_check',
                        restriction_kind: health.status === 'restricted' ? 'account_restricted' : (health.status || 'error'),
                        severity: ['restricted', 'frozen'].includes(health.status) ? 'danger' : 'warning',
                        is_restriction: health.status === 'restricted',
                        error_message: health.reason || 'Проблема при health-check.',
                        meta: {
                            account_type: account.account_type || 'userbot'
                        }
                    });
                }
            }
            catch (authErr) {
                const rawCheckError = String(authErr?.message || authErr || '').trim();
                const normalizedCheckError = rawCheckError.toUpperCase();
                const isInspectTimeout = rawCheckError.includes('health-check')
                    || rawCheckError.includes('SpamBot')
                    || rawCheckError.includes('профиль аккаунта');
                const isSessionInvalid = isExpiredUserbotSessionError(authErr)
                    || normalizedCheckError.includes('USER_DEACTIVATED')
                    || normalizedCheckError.includes('AUTH_KEY_INVALID');
                const isConnectFailure = !connectOk && (
                    rawCheckError.includes('подключение')
                    || normalizedCheckError.includes('ECONNREFUSED')
                    || normalizedCheckError.includes('ETIMEDOUT')
                    || normalizedCheckError.includes('SOCKS')
                    || normalizedCheckError.includes('NETWORK')
                    || normalizedCheckError.includes('CONNECTION')
                );
                const isDegradedAfterAlive = getMeOk && isInspectTimeout;
                const isFrozenDetected = normalizedCheckError.includes('FROZEN_METHOD_INVALID');
                const nextStatus = isFrozenDetected ? 'frozen'
                    : isConnectFailure ? 'dead_proxy'
                    : (isSessionInvalid ? 'expired'
                        : (isDegradedAfterAlive ? 'online'
                            : (isInspectTimeout ? 'error' : 'expired')));
                const nextReason = isDegradedAfterAlive
                    ? 'Сессия отвечает, но SpamBot/profile check не успел завершиться.'
                    : (rawCheckError || 'Проверка сессии не прошла.');
                console.error('Ошибка health-check юзербота:', authErr);
                await supabase.from('tg_accounts').update({
                    runtime_status: nextStatus,
                    runtime_error: isDegradedAfterAlive ? null : nextReason,
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                console.error('[USERBOT_CHECK] auth_failed', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    nextStatus,
                    connectOk,
                    getMeOk,
                    isInspectTimeout,
                    reason: nextReason
                });
                if (!isDegradedAfterAlive) {
                    await logTelegramErrorEvent(supabase, {
                        owner_id: req.user.id,
                        userbot_id: account.id,
                        event_source: 'userbot_health',
                        event_type: 'health_check',
                        restriction_kind: nextStatus,
                        error: authErr,
                        severity: nextStatus === 'expired' ? 'danger' : 'warning',
                        meta: {
                            account_type: account.account_type || 'userbot'
                        }
                    });
                }
                res.json(buildCheckResponse(
                    nextStatus,
                    nextReason,
                    {
                        session: (isDegradedAfterAlive || (connectOk && isInspectTimeout))
                            ? 'alive'
                            : (nextStatus === 'expired' ? 'dead' : 'unknown'),
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: isInspectTimeout ? 'error' : 'not_checked',
                            reason: isInspectTimeout ? nextReason : '',
                            source: isInspectTimeout ? 'inspection_timeout' : 'auth_error'
                        }
                    }
                ));
            }
            finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Ошибка проверки' }); }
    });

    // =========================================================
    // 5. CRM И СИНХРОНИЗАЦИЯ КАНАЛОВ
    // =========================================================
    router.post('/sync-channels', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Подключите Юзербота.' });
            const { data: myBots } = await supabase.from('tg_accounts').select('*').eq('owner_id', req.user.id).eq('account_type', 'bot');
            if (!myBots || myBots.length === 0) return res.status(400).json({ error: 'У вас нет официальных ботов.' });

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const syncResults = [];
            try {
                const dialogs = await client.getDialogs({ limit: 50 });
                for (const dialog of dialogs) {
                    if (dialog.isChannel || dialog.isGroup) {
                        try {
                            const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                            for (const admin of admins) {
                                const matchedBot = myBots.find(b => String(b.tg_account_id) === String(admin.id));
                                if (matchedBot) {
                                    const chatIdStr = String(dialog.id);
                                    const channelPayload = {
                                        owner_id: req.user.id,
                                        bot_id: matchedBot.id,
                                        tg_chat_id: chatIdStr,
                                        title: dialog.title,
                                        chat_type: dialog.isGroup ? 'supergroup' : 'channel',
                                        username: String(dialog.entity?.username || '').trim().replace(/^@/, '') || null,
                                        visibility: dialog.entity?.username ? 'public' : 'private',
                                        last_visibility_check_at: new Date().toISOString()
                                    };

                                    // channels.tg_chat_id глобально уникален на всех тенантов.
                                    // Guard тенантный: свою строку (в т.ч. мерж-строку того же
                                    // владельца) вставляем/обновляем, чужую (другой owner_id)
                                    // не крадём.
                                    const { data: existingChannel } = await supabase
                                        .from('channels')
                                        .select('id, owner_id')
                                        .eq('tg_chat_id', chatIdStr)
                                        .maybeSingle();

                                    let synced = true;
                                    if (!existingChannel) {
                                        await supabase.from('channels').insert(channelPayload);
                                    } else if (existingChannel.owner_id === req.user.id) {
                                        await supabase.from('channels').update(channelPayload).eq('id', existingChannel.id);
                                    } else {
                                        console.warn(`[sync-channels] Канал ${chatIdStr} принадлежит другому владельцу (${existingChannel.owner_id}), пропуск для бота ${matchedBot.id}`);
                                        synced = false;
                                    }

                                    if (synced && !syncResults.find(r => r.chat_id === chatIdStr)) syncResults.push({ chat_id: chatIdStr, chat_name: dialog.title, bot_name: matchedBot.tg_username });
                                }
                            }
                        } catch (e) {}
                    }
                }
                res.json({ success: true, count: syncResults.length, results: syncResults });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Ошибка синхронизации' }); }
    });

    router.get('/admin-audit', authenticateUser, async (req, res) => {
        try {
            const requestedUserbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const runScan = String(req.query.scan || '').trim().toLowerCase() === 'true';

            const { data: userbots } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false });

            if (!userbots || userbots.length === 0) {
                return res.status(404).json({ error: 'Подключите Юзербота.' });
            }

            const preferredAuditableUserbots = userbots.filter(item => !isFreshImportedUserbot(item));
            const userbot = requestedUserbotId
                ? userbots.find(item => String(item.id) === requestedUserbotId)
                : preferredAuditableUserbots[0] || userbots[0];

            if (!userbot) {
                return res.status(404).json({ error: 'Выбранный юзербот не найден' });
            }

            if (isFreshImportedUserbot(userbot)) {
                return res.status(409).json({ error: FRESH_IMPORT_RUNTIME_REASON });
            }

            if (isUserbotOnDeadProxy(userbot)) {
                return res.status(409).json({ error: getDeadProxyMessage() });
            }

            if (!runScan) {
                return res.json({
                    success: true,
                    scan_required: true,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    userbots: userbots.map(item => ({
                        id: item.id,
                        tg_username: item.tg_username || null,
                        tg_account_id: item.tg_account_id || null
                    })),
                    audits: []
                });
            }

            const { data: myBots } = await supabase
                .from('tg_accounts')
                .select('id, tg_account_id, tg_username')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot');

            const { data: linkedChannels } = await supabase
                .from('channels')
                .select('id, tg_chat_id, title, bot_id')
                .eq('owner_id', req.user.id);

            const proxyData = userbot.proxies
                ? {
                    proxy_host: userbot.proxies.host,
                    proxy_port: userbot.proxies.port,
                    proxy_username: userbot.proxies.username,
                    proxy_password: userbot.proxies.password
                }
                : undefined;

            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs({ limit: 70 });
                const audits = [];

                for (const dialog of dialogs) {
                    if (!dialog.isChannel && !dialog.isGroup) continue;

                    const chatIdStr = String(dialog.id);
                    const linkedChannel = (linkedChannels || []).find(channel => String(channel.tg_chat_id) === chatIdStr);

                    try {
                        let adminIds = [];
                        let userbotAdmin = false;
                        let adminCheckSkipped = false;

                        if (linkedChannel) {
                            const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                            adminIds = admins.map(admin => String(admin.id));
                            userbotAdmin = adminIds.includes(String(me.id));
                        } else {
                            adminCheckSkipped = true;
                        }

                        const matchedBots = (myBots || []).filter(bot => adminIds.includes(String(bot.tg_account_id)));

                        audits.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            userbot_admin: userbotAdmin,
                            admin_check_skipped: adminCheckSkipped,
                            official_bot_admin: matchedBots.length > 0,
                            official_bot_usernames: matchedBots.map(bot => bot.tg_username).filter(Boolean),
                            linked_channel_id: linkedChannel ? linkedChannel.id : null,
                            linked_bot_id: linkedChannel ? linkedChannel.bot_id : null
                        });
                    } catch (e) {
                        audits.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            userbot_admin: false,
                            admin_check_skipped: false,
                            official_bot_admin: false,
                            official_bot_usernames: [],
                            linked_channel_id: linkedChannel ? linkedChannel.id : null,
                            linked_bot_id: linkedChannel ? linkedChannel.bot_id : null,
                            error: 'Не удалось проверить админов'
                        });
                    }
                }

                res.json({
                    success: true,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    userbots: userbots.map(item => ({
                        id: item.id,
                        tg_username: item.tg_username || null,
                        tg_account_id: item.tg_account_id || null
                    })),
                    audits
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            res.status(500).json({ error: 'Ошибка проверки админских прав' });
        }
    });

    router.get('/ops-center', authenticateUser, async (req, res) => {
        try {
            const requestedUserbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const runScan = String(req.query.scan || '').trim().toLowerCase() === 'true';
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, req.user.id);
            const { data: paymentSettings } = await supabase
                .from('payment_settings')
                .select('admin_tg_id')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            const { data: officialBots } = await supabase
                .from('tg_accounts')
                .select('id, tg_username, tg_account_id, bot_role')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'bot')
                .order('created_at', { ascending: true });

            const { data: userbots } = await supabase
                .from('tg_accounts')
                .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .order('created_at', { ascending: false });

            if (!userbots || userbots.length === 0) {
                return res.status(404).json({ error: 'Подключите Юзербота.' });
            }

            const selection = resolveOpsCenterSelection({ userbots, reservedUserbotIds, requestedUserbotId });

            if (selection.kind === 'reserved') {
                return res.status(409).json({
                    error: 'Этот юзербот сейчас выставлен в shop и выведен из рабочей Telegram-операционки. Сними его с витрины или выбери другой аккаунт.'
                });
            }

            if (selection.kind === 'safe_mode') {
                // Запрошен свежий импорт: живой скан до активации запрещён, но
                // центр обязан отрисоваться — селектор, баннер safe-mode и кнопка
                // «Выполнить активацию». Раньше здесь падал 404 «Выбранный юзербот
                // не найден» и заменял весь центр ошибкой (баг 2026-10-20).
                return res.json({
                    success: true,
                    safe_mode: true,
                    scan_required: false,
                    cache_source: 'safe_mode',
                    selected_userbot_id: selection.userbot.id,
                    selected_userbot_username: selection.userbot.tg_username || selection.userbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: selection.operationalUserbots.map(item => buildUserbotCenterAccount(item)),
                    summary: buildUserbotCenterSummary([], []),
                    groups: [],
                    conversations: []
                });
            }

            if (selection.kind === 'no_operational') {
                return res.status(409).json({
                    error: 'Сейчас нет ни одного активированного юзербота для рабочего центра. Свежие импорты сначала нужно вручную активировать живой проверкой.'
                });
            }

            if (selection.kind === 'not_found') {
                return res.status(404).json({ error: 'Выбранный юзербот не найден' });
            }

            const preferredUserbot = selection.userbot;
            const operationalUserbots = selection.operationalUserbots;

            const { data: linkedChannels } = await supabase
                .from('channels')
                .select('id, tg_chat_id, title, bot_id')
                .eq('owner_id', req.user.id);

            if (!runScan) {
                const cache = await loadUserbotCenterCache(supabase, req.user.id, preferredUserbot.id);
                return res.json({
                    success: true,
                    scan_required: !cache.scanned_at,
                    cache_source: cache.scanned_at ? 'database' : 'empty',
                    cache_scanned_at: cache.scanned_at,
                    selected_userbot_id: preferredUserbot.id,
                    selected_userbot_username: preferredUserbot.tg_username || preferredUserbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item)),
                    summary: buildUserbotCenterSummary(cache.groups, cache.conversations),
                    groups: cache.groups,
                    conversations: cache.conversations
                });
            }

            let userbot = null;
            let client = null;
            const runtimeStates = new Map();

            const orderedCandidates = requestedUserbotId
                ? [preferredUserbot, ...operationalUserbots.filter(item => String(item.id) !== requestedUserbotId)]
                : operationalUserbots;

            for (const candidate of orderedCandidates) {
                if (isUserbotOnDeadProxy(candidate)) {
                    runtimeStates.set(String(candidate.id), {
                        status: 'dead_proxy',
                        reason: getDeadProxyMessage()
                    });
                    continue;
                }

                let candidateClient = null;
                try {
                    candidateClient = await userbotService.createAuthorizedClient(candidate, 1);
                    const health = await userbotService.inspectAccountHealth(candidateClient, {
                        userbotId: candidate.id
                    });
                    runtimeStates.set(String(candidate.id), health);
                    if (health.status === 'online') {
                        userbot = candidate;
                        client = candidateClient;
                        candidateClient = null;
                        break;
                    }
                } catch (error) {
                    const status = isExpiredUserbotSessionError(error) ? 'expired' : 'error';
                    runtimeStates.set(String(candidate.id), {
                        status,
                        reason: status === 'expired'
                            ? 'Сессия юзербота сдохла. Нужно переподключить аккаунт.'
                            : (error?.message || 'Юзербот сейчас не отвечает.')
                    });
                } finally {
                    if (candidateClient) {
                        try {
                            await candidateClient.disconnect();
                        } catch (disconnectError) {
                            console.warn('[USERBOT_CENTER] Не удалось отключить кандидата:', disconnectError?.message || disconnectError);
                        }
                    }
                }
            }

            if (!userbot || !client) {
                const preferredState = runtimeStates.get(String(preferredUserbot.id));
                const fallbackMessage = preferredState?.reason || 'Сейчас нет ни одного живого юзербота для центра.';
                return res.status(409).json({
                    error: fallbackMessage,
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item, runtimeStates.get(String(item.id)) || {
                        status: 'unknown',
                        reason: null
                    }))
                });
            }

            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs({ limit: USERBOT_CENTER_DIALOG_LIMIT });
                const groups = [];
                const conversations = [];
                let adminChecks = 0;

                for (const dialog of dialogs) {
                    const previewText = String(dialog?.message?.message || '').trim();
                    const lastMessageAt = normalizeMessageDate(dialog?.message?.date);
                    const unreadCount = Number(dialog?.unreadCount || 0);

                    if (dialog.isChannel || dialog.isGroup) {
                        const chatIdStr = String(dialog.id);
                        const linkedChannel = (linkedChannels || []).find(channel => String(channel.tg_chat_id) === chatIdStr);

                        let userbotAdmin = false;
                        let adminError = null;
                        let adminCheckSkipped = false;

                        if (linkedChannel) {
                            try {
                                if (adminChecks > 0) {
                                    await sleep(USERBOT_CENTER_ADMIN_CHECK_DELAY_MS);
                                }
                                adminChecks += 1;
                                const admins = await client.getParticipants(dialog.entity, { filter: new Api.ChannelParticipantsAdmins() });
                                userbotAdmin = admins.some(admin => String(admin.id) === String(me.id));
                            } catch (error) {
                                adminError = 'Не удалось проверить админство';
                            }
                        } else {
                            adminCheckSkipped = true;
                        }

                        groups.push({
                            chat_id: chatIdStr,
                            title: dialog.title,
                            type: dialog.isChannel ? 'channel' : 'group',
                            unread_count: unreadCount,
                            last_message_preview: previewText || null,
                            last_message_at: lastMessageAt,
                            userbot_admin: userbotAdmin,
                            admin_check_skipped: adminCheckSkipped,
                            linked_channel_id: linkedChannel?.id || null,
                            linked_channel_title: linkedChannel?.title || null,
                            admin_error: adminError
                        });
                        continue;
                    }

                    const entity = dialog.entity;
                    if (!entity || entity.className !== 'User' || entity.bot || entity.self) {
                        continue;
                    }

                    conversations.push({
                        tg_user_id: String(entity.id),
                        username: entity.username || null,
                        display_name: [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim() || entity.username || `ID ${entity.id}`,
                        unread_count: unreadCount,
                        last_message_preview: previewText || null,
                        last_message_at: lastMessageAt,
                        last_outgoing: !!dialog?.message?.out,
                        sales_signal: !dialog?.message?.out && detectSalesSignal(previewText)
                    });
                }

                groups.sort((a, b) => {
                    if (b.userbot_admin !== a.userbot_admin) return Number(b.userbot_admin) - Number(a.userbot_admin);
                    if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
                    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
                });

                conversations.sort((a, b) => {
                    if (b.sales_signal !== a.sales_signal) return Number(b.sales_signal) - Number(a.sales_signal);
                    if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
                    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
                });

                const conversationIds = conversations.map(item => item.tg_user_id);
                let notificationMap = {};
                if (conversationIds.length > 0) {
                    const { data: notifications } = await supabase
                        .from('userbot_inbox_notifications')
                        .select('dialog_tg_user_id, notified_at, last_message_id')
                        .eq('owner_id', req.user.id)
                        .eq('userbot_id', userbot.id)
                        .in('dialog_tg_user_id', conversationIds)
                        .order('notified_at', { ascending: false });

                    notificationMap = Object.fromEntries(
                        (notifications || []).map(item => [
                            String(item.dialog_tg_user_id),
                            {
                                notified_at: item.notified_at || null,
                                last_message_id: item.last_message_id || null
                            }
                        ])
                    );
                }

                const enrichedConversations = conversations.map(conversation => ({
                    ...conversation,
                    signal_notified_at: notificationMap[String(conversation.tg_user_id)]?.notified_at || null,
                    signal_last_message_id: notificationMap[String(conversation.tg_user_id)]?.last_message_id || null
                }));

                const scannedAt = new Date().toISOString();
                await replaceUserbotCenterCache(supabase, req.user.id, userbot.id, groups, enrichedConversations, scannedAt);

                res.json({
                    success: true,
                    scan_required: false,
                    cache_source: 'telegram',
                    cache_scanned_at: scannedAt,
                    selected_userbot_id: userbot.id,
                    selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
                    signal_config: buildUserbotCenterSignalConfig(paymentSettings, officialBots),
                    userbots: operationalUserbots.map(item => buildUserbotCenterAccount(item, runtimeStates.get(String(item.id)) || null)),
                    summary: buildUserbotCenterSummary(groups, enrichedConversations),
                    groups,
                    conversations: enrichedConversations
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка центра юзербота:', error);
            res.status(500).json({ error: 'Ошибка загрузки центра юзербота' });
        }
    });

    router.get('/ops-center/thread', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const tgUserId = req.query.tg_user_id ? String(req.query.tg_user_id) : null;

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан TG ID диалога' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            try {
                let peer = null;

                try {
                    peer = await client.getInputEntity(tgUserId);
                } catch {
                    peer = null;
                }

                if (!peer) {
                    try {
                        const dialogs = await client.getDialogs({ limit: 70 });
                        for (const dialog of dialogs) {
                            if (String(dialog.id) === tgUserId || (dialog.entity && String(dialog.entity.id) === tgUserId)) {
                                peer = dialog.entity;
                                break;
                            }
                        }
                    } catch {}
                }

                if (!peer) {
                    return res.json({
                        success: true,
                        messages: [],
                        unavailable_reason: 'Юзербот не нашёл диалог с этим пользователем.'
                    });
                }

                const messages = await client.getMessages(peer, { limit: 20 });
                const rows = (messages || [])
                    .map(message => ({
                        id: String(message.id),
                        outgoing: !!message.out,
                        text: String(message.message || '').trim(),
                        date: normalizeMessageDate(message.date)
                    }))
                    .filter(message => message.text || message.date)
                    .reverse();

                res.json({ success: true, messages: rows, unavailable_reason: null });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка загрузки треда юзербота:', error);
            res.status(500).json({ error: 'Ошибка загрузки переписки' });
        }
    });

    router.post('/ops-center/mark-read', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const tgUserId = req.body?.tg_user_id ? String(req.body.tg_user_id) : null;

            if (!tgUserId) {
                return res.status(400).json({ error: 'Не передан TG ID диалога' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            await userbotService.markDialogAsRead(userbot, tgUserId);
            res.json({ success: true });
        } catch (error) {
            console.error('Ошибка отметки диалога как прочитанного:', error);
            res.status(500).json({ error: error?.message || 'Не получилось отметить диалог как прочитанный' });
        }
    });

    router.post('/ops-center/join-invite', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const inviteLink = String(req.body?.invite_link || '').trim();
            if (!inviteLink) {
                return res.status(400).json({ error: 'Не вставлена пригласительная ссылка' });
            }

            const parsedInvite = parseTelegramInvite(inviteLink);
            if (!parsedInvite) {
                return res.status(400).json({ error: 'Ссылка кривовата. Поддерживаются: t.me/+hash, t.me/joinchat/hash, t.me/username, @username.' });
            }
            if (parsedInvite.kind === 'private_permalink') {
                return res.status(400).json({
                    error: 'Это ссылка на сообщение в приватном канале (t.me/c/<id>). Чтобы зайти в приватный канал/группу, нужна пригласительная ссылка (t.me/+hash или t.me/joinchat/hash).'
                });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const client = await userbotService.createAuthorizedClient(userbot, 1);
            try {
                let title = 'Неизвестная группа';
                let chatId = null;

                if (parsedInvite.kind === 'invite_hash') {
                    const result = await client.invoke(new Api.messages.ImportChatInvite({
                        hash: parsedInvite.value
                    }));
                    const chat = result?.chats?.[0] || null;
                    title = chat?.title || title;
                    chatId = chat?.id ? String(chat.id) : null;
                } else {
                    const entity = await client.getEntity(parsedInvite.value);
                    await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                    title = entity?.title || entity?.username || title;
                    chatId = entity?.id ? String(entity.id) : null;
                }

                res.json({
                    success: true,
                    title,
                    chat_id: chatId,
                    userbot_id: userbot.id
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('Ошибка входа по инвайту:', error);
            res.status(500).json({ error: 'Не получилось зайти по ссылке этим юзерботом' });
        }
    });

    router.get('/ops-center/authorizations', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.getAccountAuthorizations(userbot);
            res.json({ success: true, authorizations });
        } catch (error) {
            console.error('Ошибка загрузки активных сессий юзербота:', error);
            res.status(500).json({ error: error?.message || 'Не получилось загрузить активные сессии' });
        }
    });

    router.post('/ops-center/authorizations/reset-others', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.resetOtherAuthorizations(userbot);
            res.json({
                success: true,
                authorizations,
                message: 'Все остальные Telegram-сессии этого аккаунта разлогинены. На сервисе осталась текущая сессия.'
            });
        } catch (error) {
            console.error('Ошибка сброса остальных сессий юзербота:', error);
            res.status(500).json({ error: error?.message || 'Не получилось разлогинить остальные устройства' });
        }
    });

    router.post('/ops-center/authorizations/reset-one', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
            const hash = req.body?.hash !== undefined && req.body?.hash !== null
                ? String(req.body.hash)
                : '';
            if (!hash) {
                return res.status(400).json({ error: 'Не передан hash сессии' });
            }

            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) {
                return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });
            }

            const authorizations = await userbotService.resetAuthorization(userbot, hash);
            res.json({
                success: true,
                authorizations,
                message: 'Сессия разлогинена.'
            });
        } catch (error) {
            console.error('Ошибка сброса конкретной сессии юзербота:', error);
            res.status(error?.statusCode || 500).json({ error: error?.message || 'Не получилось разлогинить устройство' });
        }
    });

    router.get('/error-events', authenticateUser, async (req, res) => {
        try {
            const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : '';
            const restrictionsOnly = String(req.query.restrictions_only || '').trim().toLowerCase() === 'true';

            let query = supabase
                .from('telegram_error_events')
                .select('id, owner_id, userbot_id, tg_user_id, event_source, event_type, severity, restriction_kind, is_restriction, error_code, error_message, happened_at, meta')
                .eq('owner_id', req.user.id)
                .order('happened_at', { ascending: false })
                .limit(limit);

            if (userbotId) {
                query = query.eq('userbot_id', userbotId);
            }
            if (restrictionsOnly) {
                query = query.eq('is_restriction', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            res.json({
                success: true,
                events: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось загрузить журнал Telegram-ошибок.' });
        }
    });

    // =========================================================
    // 6. СКАНЕР УЧАСТНИКОВ (FETCH MEMBERS)
    // =========================================================
    router.post('/fetch-members', authenticateUser, async (req, res) => {
        const { tg_chat_id, userbot_id } = req.body;
        if (!tg_chat_id) return res.status(400).json({ error: 'ID чата не передан' });

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbot_id ? String(userbot_id) : null, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'У вас не подключен Юзербот.' });

            const { data: channel } = await supabase.from('channels').select('id').eq('tg_chat_id', String(tg_chat_id)).single();

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            try {
                const participants = await client.getParticipants(tg_chat_id, { limit: 300 });

                let activeSubs = [];
                if (channel) {
                    const { data: subs } = await supabase.from('subscriptions').select('*').eq('channel_id', channel.id).eq('status', 'active');
                    if (subs) activeSubs = subs;
                }

                const members = participants.map(p => {
                    const participantIdStr = String(p.id);
                    const sub = activeSubs.find(s => String(s.tg_user_id) === participantIdStr);

                    return {
                        id: participantIdStr,
                        username: p.username || null,
                        first_name: p.firstName || '',
                        last_name: p.lastName || '',
                        is_bot: p.bot || false,
                        is_premium: p.premium || false,
                        has_subscription: !!sub,
                        expires_at: sub ? sub.expires_at : null
                    };
                });

                res.json({ success: true, chat_id: tg_chat_id, count: members.length, members: members });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка сервера' }); }
    });

    // =========================================================
    // 7. CRM БАЗА КЛИЕНТОВ - ПОЛУЧЕНИЕ
    // =========================================================
    router.get('/crm/subscribers', authenticateUser, async (req, res) => {
        try {
            const { data: channels } = await supabase.from('channels').select('id, title').eq('owner_id', req.user.id);
            if (!channels || channels.length === 0) return res.json({ subscribers: [] });

            const channelIds = channels.map(c => c.id);
            const { data: subs, error } = await supabase.from('subscriptions').select('*').in('channel_id', channelIds).order('created_at', { ascending: false });
            if (error) throw error;

            const result = subs.map(sub => {
                const ch = channels.find(c => c.id === sub.channel_id);
                return { ...sub, channel_title: ch ? ch.title : 'Неизвестный канал' };
            });

            res.json({ subscribers: result });
        } catch (error) { res.status(500).json({ error: 'Ошибка загрузки базы данных' }); }
    });

    // =========================================================
    // 8. CRM БАЗА КЛИЕНТОВ - ПОДАРИТЬ ДНИ
    // =========================================================
    router.post('/crm/subscribers/:id/add-days', authenticateUser, async (req, res) => {
        const subId = req.params.id;
        const { days } = req.body;

        try {
            const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', subId).single();
            if (!sub) return res.status(404).json({ error: 'Подписка не найдена' });

            const { data: channel } = await supabase.from('channels').select('*').eq('id', sub.channel_id).single();
            if (!channel || channel.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

            let newExpiresAt = null;
            if (days !== 'forever') {
                const now = new Date();
                let baseDate = new Date();
                if (sub.status === 'active' && sub.expires_at) {
                    const currentExp = new Date(sub.expires_at);
                    if (currentExp > now) baseDate = currentExp;
                }
                baseDate.setDate(baseDate.getDate() + parseInt(days));
                newExpiresAt = baseDate.toISOString();
            }

            await supabase.from('subscriptions').update({ expires_at: newExpiresAt, status: 'active' }).eq('id', subId);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка' }); }
    });

    const MAX_EXTENSION_DAYS = 3650;

    // 'forever' или целое число дней 1..3650; иначе null (и роут вернет 400,
    // а не 500 от parseInt('abc') -> NaN -> Invalid Date).
    function parseExtensionDays(days) {
        if (days === 'forever') return 'forever';
        const num = Number(days);
        if (!Number.isInteger(num) || num < 1 || num > MAX_EXTENSION_DAYS) return null;
        return num;
    }

    router.post('/crm/subscribers/batch-add-days', authenticateUser, async (req, res) => {
        const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids.map(String) : [];
        const { days } = req.body || {};

        if (subscriptionIds.length === 0) {
            return res.status(400).json({ error: 'Не переданы подписки для продления' });
        }

        const daysNum = parseExtensionDays(days);
        if (daysNum === null) {
            return res.status(400).json({ error: `days должен быть целым числом от 1 до ${MAX_EXTENSION_DAYS} или строкой "forever"` });
        }

        try {
            const { data: subscriptions, error } = await supabase
                .from('subscriptions')
                .select('*')
                .in('id', subscriptionIds);

            if (error) throw error;
            if (!subscriptions || subscriptions.length === 0) {
                return res.status(404).json({ error: 'Подписки не найдены' });
            }

            const channelIds = Array.from(new Set(subscriptions.map(sub => sub.channel_id).filter(Boolean)));
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, owner_id')
                .in('id', channelIds);

            if (channelsError) throw channelsError;

            const ownedChannelIds = new Set((channels || []).filter(channel => channel.owner_id === req.user.id).map(channel => channel.id));
            const allowedSubscriptions = subscriptions.filter(sub => ownedChannelIds.has(sub.channel_id));

            if (allowedSubscriptions.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к этим подпискам' });
            }

            let updated = 0;
            let conflicts = 0;
            let failed = 0;

            for (const sub of allowedSubscriptions) {
                let current = sub;
                let applied = false;
                let kickedRestore = false;

                // Оптимистический гард от TOCTOU: read-modify-write expires_at без
                // гарда теряет параллельные продления. Апдейт проходит только если
                // expires_at не изменился с момента чтения; конфликт — перечитываем
                // подписку, пересчитываем и повторяем (максимум 2 ретрая).
                for (let attempt = 0; attempt < 3 && !applied; attempt++) {
                    let newExpiresAt = null;
                    if (daysNum !== 'forever') {
                        const now = new Date();
                        let baseDate = new Date();
                        if (current.status === 'active' && current.expires_at) {
                            const currentExp = new Date(current.expires_at);
                            if (currentExp > now) baseDate = currentExp;
                        }
                        baseDate.setDate(baseDate.getDate() + daysNum);
                        newExpiresAt = baseDate.toISOString();
                    }

                    const updates = {
                        expires_at: newExpiresAt,
                        status: 'active'
                    };

                    if (current.last_access_event === 'kicked') {
                        updates.last_access_event = 'manual_restore';
                        updates.access_note = daysNum === 'forever'
                            ? 'Доступ восстановлен вручную из админки навсегда'
                            : `Доступ восстановлен вручную из админки на ${daysNum} дней`;
                    }

                    let guardedQuery = supabase.from('subscriptions').update(updates).eq('id', sub.id);
                    guardedQuery = current.expires_at == null
                        ? guardedQuery.is('expires_at', null)
                        : guardedQuery.eq('expires_at', current.expires_at);

                    const { data: updatedRows, error: updateError } = await guardedQuery.select('id');

                    // Ошибка одной строки не роняет batch: часть подписок уже
                    // продлена, остальные должны получить попытку. Считаем в failed.
                    if (updateError) {
                        failed += 1;
                        console.error('batch-add-days: сбой обновления подписки', sub.id, updateError.message || updateError);
                        break;
                    }

                    if ((updatedRows || []).length > 0) {
                        applied = true;
                        // Событие restored пишем по состоянию применённой итерации,
                        // а не по первоначально прочитанной подписке
                        kickedRestore = current.last_access_event === 'kicked';
                    } else {
                        const { data: rereadSub, error: rereadError } = await supabase
                            .from('subscriptions')
                            .select('*')
                            .eq('id', sub.id)
                            .single();
                        if (rereadError) {
                            failed += 1;
                            console.error('batch-add-days: сбой перечитывания подписки', sub.id, rereadError.message || rereadError);
                            break;
                        }
                        if (!rereadSub) break;
                        current = rereadSub;
                    }
                }

                if (!applied) {
                    conflicts += 1;
                    continue;
                }

                if (kickedRestore) {
                    await supabase.from('access_events').insert({
                        owner_id: req.user.id,
                        channel_id: sub.channel_id,
                        subscription_id: sub.id,
                        invoice_id: null,
                        invite_id: null,
                        tg_user_id: String(sub.tg_user_id),
                        event_type: 'restored',
                        event_source: 'manual_restore',
                        payload: {
                            days: daysNum === 'forever' ? 'forever' : daysNum,
                            source: 'admin_extend',
                            note: daysNum === 'forever'
                                ? 'Доступ восстановлен вручную из админки навсегда'
                                : `Доступ восстановлен вручную из админки на ${daysNum} дней`
                        }
                    });
                }

                updated += 1;
            }

            res.json({
                success: true,
                requested: subscriptionIds.length,
                updated,
                conflicts,
                failed
            });
        } catch (error) {
            console.error('Ошибка batch-add-days:', error);
            res.status(500).json({ error: 'Внутренняя ошибка batch-продления' });
        }
    });

    router.post('/crm/subscribers/batch-kick', authenticateUser, async (req, res) => {
        const subscriptionIds = Array.isArray(req.body?.subscription_ids) ? req.body.subscription_ids.map(String) : [];
        const userbotId = req.body?.userbot_id ? String(req.body.userbot_id) : null;
        const batchKickSource = resolveBatchKickCallSource(
            req.body?.action_source,
            req.body?.source,
            req.body?.event_source
        );

        if (subscriptionIds.length === 0) {
            return res.status(400).json({ error: 'Не переданы подписки для кика' });
        }

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            const { data: subscriptions, error } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .in('id', subscriptionIds);

            if (error) throw error;
            if (!subscriptions || subscriptions.length === 0) {
                return res.status(404).json({ error: 'Подписки не найдены' });
            }

            const channelIds = Array.from(new Set(subscriptions.map(sub => sub.channel_id).filter(Boolean)));
            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, owner_id, tg_chat_id')
                .in('id', channelIds);

            if (channelsError) throw channelsError;

            const channelMap = new Map((channels || []).filter(channel => channel.owner_id === req.user.id).map(channel => [channel.id, channel]));
            const allowedSubscriptions = subscriptions.filter(sub => channelMap.has(sub.channel_id));

            if (allowedSubscriptions.length === 0) {
                return res.status(403).json({ error: 'Нет доступа к этим подпискам' });
            }

            let kicked = 0;

            for (const sub of allowedSubscriptions) {
                const channel = channelMap.get(sub.channel_id);
                if (!channel?.tg_chat_id) continue;

                try {
                    await userbotService.kickMemberFromChannel(userbot, channel.tg_chat_id, sub.tg_user_id);

                    await supabase.from('access_events').insert({
                        owner_id: req.user.id,
                        channel_id: sub.channel_id,
                        subscription_id: sub.id,
                        invoice_id: null,
                        invite_id: null,
                        tg_user_id: String(sub.tg_user_id),
                        event_type: 'kicked',
                        event_source: batchKickSource.eventSource,
                        payload: {
                            source: batchKickSource.payloadSource,
                            note: batchKickSource.accessNote,
                            ...(batchKickSource.removalKind
                                ? { removal_kind: batchKickSource.removalKind }
                                : {})
                        }
                    });

                    const subscriptionPatch = {
                        last_access_event: 'kicked',
                        access_note: batchKickSource.accessNote
                    };

                    if (batchKickSource.shouldExpireSubscription) {
                        subscriptionPatch.status = 'expired';
                    }

                    await supabase
                        .from('subscriptions')
                        .update(subscriptionPatch)
                        .eq('id', sub.id);

                    kicked += 1;
                } catch (kickError) {
                    console.error(`Ошибка batch-kick для ${sub.tg_user_id}:`, kickError.message);
                }
            }

            res.json({
                success: true,
                requested: subscriptionIds.length,
                kicked
            });
        } catch (error) {
            console.error('Ошибка batch-kick:', error);
            res.status(500).json({ error: 'Внутренняя ошибка batch-кика' });
        }
    });

    // =========================================================
    // 9. ОТПРАВКА СООБЩЕНИЯ В ЛИЧКУ
    // =========================================================
    router.post('/send-message', authenticateUser, async (req, res) => {
        if (!isUserbotDmEnabled()) {
            return res.status(403).json({
                error: 'Ручная отправка в ЛС через юзербота сейчас отключена в конфиге.'
            });
        }
        if (req.body?.manual_confirmed !== true) {
            return res.status(403).json({
                error: 'ЛС через юзербота теперь отправляются только после явного подтверждения из интерфейса.'
            });
        }
        const { tg_user_id, message, userbot_id, common_chat_id, known_dialog } = req.body;
        if (!tg_user_id || !message) return res.status(400).json({ error: 'Не указан ID пользователя или текст' });
        if (!/^\d+$/.test(String(tg_user_id).trim())) {
            return res.status(400).json({ error: 'TG ID должен быть числовым.' });
        }
        if (String(message).trim().length > 4000) {
            return res.status(400).json({ error: 'Сообщение слишком длинное. Оставь до 4000 символов.' });
        }
        if (!String(common_chat_id || '').trim() && known_dialog !== true) {
            return res.status(400).json({
                error: 'Для ручной отправки по TG ID теперь нужен явный общий чат. Если диалог уже открыт в центре, отвечай из существующей переписки.'
            });
        }

        try {
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbot_id ? String(userbot_id) : null, {
                allowFailover: true
            });
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            await userbotService.sendMessage(userbot, tg_user_id, String(message).trim(), {
                common_chat_id: common_chat_id ? String(common_chat_id).trim() : ''
            });
            res.json({ success: true });
        } catch (error) {
            const text = String(error?.message || '');
            const status = (
                text.includes('Юзербот не знает этот TG ID')
                || text.includes('заблокировал юзербота')
                || text.includes('приватность')
                || text.includes('flood wait')
                || text.includes('не может писать')
                || text.includes('Сессия юзербота сдохла')
            ) ? 400 : 500;
            res.status(status).json({ error: text || 'Внутренняя ошибка сервера' });
        }
    });

    // =========================================================
    // 10. МАССОВЫЙ ИМПОРТ ИЗ СКАНЕРА
    // =========================================================
    router.post('/crm/import', authenticateUser, async (req, res) => {
        const { tg_user_ids, days, channel_id } = req.body;

        if (!tg_user_ids || !Array.isArray(tg_user_ids) || tg_user_ids.length === 0) {
            return res.status(400).json({ error: 'Не переданы пользователи' });
        }

        if (!channel_id) {
            return res.status(400).json({ error: 'Не передан канал для импорта' });
        }

        try {
            const { data: channel } = await supabase
                .from('channels')
                .select('*')
                .eq('id', channel_id)
                .eq('owner_id', req.user.id)
                .single();

            if (!channel) return res.status(400).json({ error: 'Канал не найден или недоступен' });

            let expiresAt = null;
            if (days !== 'forever') {
                const date = new Date();
                date.setDate(date.getDate() + parseInt(days));
                expiresAt = date.toISOString();
            }

            const upsertData = tg_user_ids.map(uid => ({
                tg_user_id: String(uid),
                                                       channel_id: channel.id,
                                                       status: 'active',
                                                       expires_at: expiresAt
            }));

            const { error: insertError } = await supabase.from('subscriptions').upsert(upsertData, { onConflict: 'tg_user_id, channel_id' });
            if (insertError) throw insertError;

            res.json({ success: true, imported_count: tg_user_ids.length });
        } catch (error) { res.status(500).json({ error: 'Ошибка БД при импорте' }); }
    });

    // =========================================================
    // 11. ПРОВЕРКА НАЛИЧИЯ ПОЛЬЗОВАТЕЛЕЙ В ГРУППАХ
    // =========================================================
    router.get('/crm/presence', authenticateUser, async (req, res) => {
        try {
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const { userbot, error: userbotError } = await loadOperationalUserbot(supabase, req.user.id, userbotId);
            if (!userbot) return res.status(409).json({ error: userbotError || 'Юзербот не подключен.' });

            const { data: channels } = await supabase.from('channels').select('*').eq('owner_id', req.user.id);
            if (!channels || channels.length === 0) return res.json({ presence: {} });

            const proxyData = userbot.proxies ? { proxy_host: userbot.proxies.host, proxy_port: userbot.proxies.port, proxy_username: userbot.proxies.username, proxy_password: userbot.proxies.password } : undefined;
            const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            await userbotService.connectWithProxyFallback(client, proxyData);

            const presenceMap = {};

            try {
                for (const channel of channels) {
                    try {
                        const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                        presenceMap[channel.id] = participants.map(p => String(p.id));
                    } catch (e) {
                        presenceMap[channel.id] = [];
                    }
                }
                res.json({ success: true, presence: presenceMap });
            } finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Внутренняя ошибка сервера при проверке присутствия' }); }
    });

    return router;
}
