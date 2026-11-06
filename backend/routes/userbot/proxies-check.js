// Удаление ручного прокси и проверка на живучесть (стадия 2a разрезки userbot.routes.js).
// Зона: DELETE /proxies/:id, GET /proxies/check/:id. Выделено из зоны proxies-crud
// в отдельный файл из-за лимита размера; регистрируется сразу после registerProxiesCrud.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import {
    PROXY_CHECK_COOLDOWN_MS,
    proxyCheckCooldown,
    supportsProxyInventoryGroup,
    supportsProxyProvisionSource
} from './helpers-proxy.js';
import {
    buildTrialLeaseFromMetadata,
    loadUserMetadata,
    persistUserMetadata
} from './helpers-lease.js';

export function registerProxiesCheck(router, ctx) {
    const { supabase, userbotService, managedProxyService } = ctx;
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

}
