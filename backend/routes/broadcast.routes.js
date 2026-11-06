import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { buildAudience, buildAudienceKey } from './broadcast/build-audience.js';
import { registerCampaignRoutes } from './broadcast/campaign-routes.js';

export default function(supabase) {
    const router = express.Router();

    async function loadOwnerContext(ownerId) {
        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        const [{ data: channels }, { data: userbots }] = await Promise.all([
            supabase.from('channels').select('id, title, bot_id, tg_chat_id').eq('owner_id', ownerId),
            supabase.from('tg_accounts').select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)').eq('owner_id', ownerId).eq('account_type', 'userbot').order('created_at', { ascending: false })
        ]);

        return {
            channels: channels || [],
            userbots: (userbots || []).filter(userbot =>
                !reservedUserbotIds.has(String(userbot.id)) &&
                !(userbot.proxy_id && userbot.proxies?.is_working === false)
            )
        };
    }

    async function loadLatestPaidTariffMap(channelIds = []) {
        if (channelIds.length === 0) return new Map();

        const { data: tariffs, error: tariffsError } = await supabase
            .from('tariffs')
            .select('id, channel_id, title, is_trial, trial_label, price, currency')
            .in('channel_id', channelIds);

        if (tariffsError) throw tariffsError;

        const tariffIds = (tariffs || []).map(tariff => tariff.id);
        const tariffMap = new Map((tariffs || []).map(tariff => [tariff.id, tariff]));
        if (tariffIds.length === 0) return new Map();

        const { data: invoices, error } = await supabase
            .from('invoices')
            .select('tg_user_id, tariff_id, paid_at, created_at')
            .in('tariff_id', tariffIds)
            .eq('status', 'paid')
            .order('paid_at', { ascending: false })
            .limit(5000);

        if (error) throw error;

        const latestTariffMap = new Map();
        for (const invoice of invoices || []) {
            const tariff = tariffMap.get(invoice.tariff_id);
            if (!tariff) continue;

            const key = buildAudienceKey(String(invoice.tg_user_id), tariff.channel_id);
            if (latestTariffMap.has(key)) continue;

            latestTariffMap.set(key, {
                is_trial: !!tariff.is_trial,
                trial_label: tariff.trial_label || null,
                title: tariff.title,
                price: tariff.price,
                currency: tariff.currency
            });
        }

        return latestTariffMap;
    }

    registerCampaignRoutes(router, { supabase, buildAudience, loadOwnerContext, loadLatestPaidTariffMap });

    // Стоп кампании: queued/sending → cancelled. Джоба доставки проверяет статус перед
    // каждым получателем и финализирует только из 'sending' — отмена всегда выигрывает.
    router.post('/campaigns/:id/cancel', authenticateUser, async (req, res) => {
        try {
            const campaignId = String(req.params.id || '').trim();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
                return res.status(404).json({ error: 'Кампания не найдена или уже не активна' });
            }

            const { data: existing, error: loadError } = await supabase
                .from('broadcast_campaigns')
                .select('meta')
                .eq('id', campaignId)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (loadError) throw loadError;
            if (!existing) {
                return res.status(404).json({ error: 'Кампания не найдена или уже не активна' });
            }

            const nowIso = new Date().toISOString();
            const { data: cancelled, error: cancelError } = await supabase
                .from('broadcast_campaigns')
                .update({
                    status: 'cancelled',
                    meta: { ...(existing.meta || {}), cancelled_at: nowIso }
                })
                .eq('id', campaignId)
                .eq('owner_id', req.user.id)
                .in('status', ['queued', 'sending'])
                .select('id');
            if (cancelError) throw cancelError;
            if (!cancelled || cancelled.length === 0) {
                return res.status(404).json({ error: 'Кампания не найдена или уже не активна' });
            }

            res.json({ ok: true, status: 'cancelled', cancelled_at: nowIso });
        } catch (error) {
            console.error('Ошибка отмены кампании:', error);
            res.status(500).json({ error: 'Ошибка отмены рассылки' });
        }
    });

    return router;
}
