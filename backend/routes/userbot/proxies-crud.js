// Создание пачки ручных прокси (стадия 2a разрезки userbot.routes.js).
// Зона: POST /proxies. DELETE /proxies/:id и GET /proxies/check/:id —
// в proxies-check.js (лимит размера файла), порядок регистрации сохранён.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { enforceOwnedProxyQuota } from '../../utils/product-tier.js';
import { buildBatchProxyNames, buildManagedProxyPendingMessage } from '../../utils/proxy-batch.js';
import {
    launchManagedProxyVerification,
    loadOwnedProxy,
    maskCredential,
    normalizeAdminInventoryGroup,
    normalizeManagedBatchCount,
    supportsProxyInventoryGroup,
    supportsProxyProvisionSource
} from './helpers-proxy.js';
import { MAX_MANAGED_PROXIES_GLOBAL, MAX_MANAGED_PROXIES_PER_ADMIN } from './constants.js';

export function registerProxiesCrud(router, ctx) {
    const { supabase, userbotService, managedProxyService } = ctx;
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

}
