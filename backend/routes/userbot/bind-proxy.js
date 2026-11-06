// Привязка прокси к юзерботу вручную (стадия 2a разрезки userbot.routes.js).
// Зона: POST /bind-proxy.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { ensureExclusiveProxyAssignment, loadOwnedProxy } from './helpers-proxy.js';
import { reconcileExpiredTrialProxyLease } from './helpers-lease.js';

export function registerBindProxy(router, ctx) {
    const { supabase } = ctx;
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

}
