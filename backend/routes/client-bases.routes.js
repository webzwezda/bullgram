import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

const VALID_SOURCES = new Set(['manual', 'copied', 'imported']);

function cleanEntry(entry) {
    const tgUserId = String(entry?.tg_user_id || '').trim();
    if (!tgUserId) return null;
    const username = String(entry?.username || '').trim().replace(/^@+/, '');
    const displayName = String(entry?.display_name || '').trim();
    const sourceRaw = String(entry?.source || '').trim();
    const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : 'manual';
    return { tg_user_id: tgUserId, username, display_name: displayName, source };
}

export default function clientBasesRoutes(supabase) {
    const router = express.Router();

    async function loadOwnedBase(ownerId, baseId) {
        const { data: base, error } = await supabase
            .from('client_bases')
            .select('*')
            .eq('id', baseId)
            .eq('owner_id', ownerId)
            .single();
        if (error || !base) return null;
        return base;
    }

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const [{ data: bases, error: basesError }, { data: members, error: membersError }] = await Promise.all([
                supabase
                    .from('client_bases')
                    .select('id, name, description, created_at, updated_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('client_base_members')
                    .select('base_id')
                    .eq('owner_id', ownerId)
            ]);

            if (basesError) throw basesError;
            if (membersError) throw membersError;

            const counts = new Map();
            for (const row of members || []) {
                counts.set(row.base_id, (counts.get(row.base_id) || 0) + 1);
            }

            const hydratedBases = (bases || []).map((base) => ({
                ...base,
                stats: { total: counts.get(base.id) || 0 }
            }));

            res.json({ bases: hydratedBases });
        } catch (error) {
            console.error('Ошибка загрузки баз клиентов:', error);
            res.status(500).json({ error: 'Ошибка загрузки баз клиентов' });
        }
    });

    router.post('/', authenticateUser, async (req, res) => {
        try {
            const { name, description } = req.body;
            if (!name || !String(name).trim()) {
                return res.status(400).json({ error: 'Назови базу, а то непонятно что ты создаешь' });
            }

            const payload = {
                owner_id: req.user.id,
                name: String(name).trim(),
                description: description ? String(description).trim() : null
            };

            const { data, error } = await supabase
                .from('client_bases')
                .insert(payload)
                .select('id')
                .single();

            if (error) throw error;
            res.json({ id: data?.id || null });
        } catch (error) {
            console.error('Ошибка создания базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка создания базы клиентов' });
        }
    });

    router.patch('/:id', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const { name, description } = req.body;
            const payload = { updated_at: new Date().toISOString() };
            if (typeof name === 'string') {
                if (!name.trim()) {
                    return res.status(400).json({ error: 'Название не может быть пустым' });
                }
                payload.name = name.trim();
            }
            if (typeof description === 'string') {
                payload.description = description.trim();
            }

            const { data, error } = await supabase
                .from('client_bases')
                .update(payload)
                .eq('id', baseId)
                .eq('owner_id', req.user.id)
                .select('id')
                .single();

            if (error) throw error;
            res.json({ id: data?.id || baseId });
        } catch (error) {
            console.error('Ошибка обновления базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка обновления базы клиентов' });
        }
    });

    router.delete('/:id', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const { error } = await supabase
                .from('client_bases')
                .delete()
                .eq('id', baseId)
                .eq('owner_id', req.user.id);

            if (error) throw error;
            res.json({ id: baseId });
        } catch (error) {
            console.error('Ошибка удаления базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка удаления базы клиентов' });
        }
    });

    router.get('/:id/members', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const baseId = req.params.id;
            const base = await loadOwnedBase(ownerId, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
            const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

            let query = supabase
                .from('client_base_members')
                .select('id, tg_user_id, username, display_name, source, added_at', { count: 'exact' })
                .eq('owner_id', ownerId)
                .eq('base_id', baseId)
                .order('added_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (search) {
                const like = `%${search}%`;
                query = query.or(`display_name.ilike.${like},username.ilike.${like},tg_user_id.ilike.${like}`);
            }

            const { data: members, error: membersError, count } = await query;
            if (membersError) throw membersError;

            const cbMembers = members || [];
            const tgUserIds = cbMembers.map(m => String(m.tg_user_id));

            if (tgUserIds.length === 0) {
                return res.json({
                    members: [],
                    summary: { total: count || 0 }
                });
            }

            // Enrich: where this user is across owner's channels + payment status.
            const ownerBases = await supabase
                .from('channel_audiences')
                .select('id')
                .eq('owner_id', ownerId);
            const ownerBaseIds = (ownerBases.data || []).map(b => b.id);

            let linkedChannels = [];
            let linkedChannelIds = [];
            if (ownerBaseIds.length > 0) {
                const links = await supabase
                    .from('channel_audience_channels')
                    .select('channel_id, channels(id, title)')
                    .in('base_id', ownerBaseIds);
                const channelMap = new Map();
                for (const link of links.data || []) {
                    const ch = link.channels;
                    if (ch && !channelMap.has(ch.id)) channelMap.set(ch.id, ch);
                }
                linkedChannels = Array.from(channelMap.values());
                linkedChannelIds = linkedChannels.map(c => c.id);
            }

            const audienceMembersRes = linkedChannelIds.length > 0 || ownerBaseIds.length > 0
                ? await supabase
                    .from('channel_audience_members')
                    .select('tg_user_id, source_channel_ids, channels_count, present_now, is_bot')
                    .eq('owner_id', ownerId)
                    .in('tg_user_id', tgUserIds)
                : { data: [], error: null };
            if (audienceMembersRes.error) throw audienceMembersRes.error;

            // Aggregate per tg_user_id (one user can be in multiple bases).
            const audienceByUser = new Map();
            for (const am of audienceMembersRes.data || []) {
                const key = String(am.tg_user_id);
                const existing = audienceByUser.get(key);
                if (!existing) {
                    audienceByUser.set(key, {
                        source_channel_ids: Array.isArray(am.source_channel_ids) ? [...am.source_channel_ids] : [],
                        channels_count: am.channels_count || 0,
                        present_now: !!am.present_now,
                        is_bot: !!am.is_bot
                    });
                } else {
                    for (const cid of (am.source_channel_ids || [])) {
                        if (!existing.source_channel_ids.includes(cid)) existing.source_channel_ids.push(cid);
                    }
                    existing.channels_count = Math.max(existing.channels_count, am.channels_count || 0);
                    existing.present_now = existing.present_now || !!am.present_now;
                    existing.is_bot = existing.is_bot || !!am.is_bot;
                }
            }

            // Payment status from subscriptions + invoices.
            const tariffsRes = linkedChannelIds.length > 0
                ? await supabase
                    .from('tariffs')
                    .select('id, channel_id')
                    .in('channel_id', linkedChannelIds)
                : { data: [], error: null };
            if (tariffsRes.error) throw tariffsRes.error;
            const linkedTariffIds = (tariffsRes.data || []).map(t => t.id);

            const [subsRes, invoicesRes] = await Promise.all([
                linkedChannelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('tg_user_id, channel_id, status, expires_at')
                        .in('channel_id', linkedChannelIds)
                        .in('tg_user_id', tgUserIds)
                    : Promise.resolve({ data: [], error: null }),
                linkedTariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        .select('tg_user_id, status, created_at, paid_at')
                        .in('tariff_id', linkedTariffIds)
                        .in('tg_user_id', tgUserIds)
                    : Promise.resolve({ data: [], error: null })
            ]);
            if (subsRes.error) throw subsRes.error;
            if (invoicesRes.error) throw invoicesRes.error;

            const nowIso = new Date().toISOString();
            const subsByUser = new Map();
            for (const sub of subsRes.data || []) {
                const key = String(sub.tg_user_id);
                if (!subsByUser.has(key)) subsByUser.set(key, { active: 0, expired: 0 });
                const stats = subsByUser.get(key);
                const isActive = sub.status === 'active' && (!sub.expires_at || sub.expires_at >= nowIso);
                if (isActive) stats.active += 1;
                else stats.expired += 1;
            }

            const invoicesByUser = new Map();
            for (const inv of invoicesRes.data || []) {
                const key = String(inv.tg_user_id);
                if (!invoicesByUser.has(key)) invoicesByUser.set(key, { has_paid: false, has_pending: false });
                const stats = invoicesByUser.get(key);
                if (inv.status === 'paid') stats.has_paid = true;
                if (['pending', 'awaiting_receipt', 'wait_admin'].includes(inv.status)) stats.has_pending = true;
            }

            const hydrated = cbMembers.map(member => {
                const key = String(member.tg_user_id);
                const aud = audienceByUser.get(key);
                const presentChannelIds = aud?.source_channel_ids || [];
                const presentChannelTitles = linkedChannels
                    .filter(c => presentChannelIds.includes(c.id))
                    .map(c => c.title);
                const missingChannelTitles = linkedChannels
                    .filter(c => !presentChannelIds.includes(c.id))
                    .map(c => c.title);

                const subs = subsByUser.get(key) || { active: 0, expired: 0 };
                const invs = invoicesByUser.get(key) || { has_paid: false, has_pending: false };

                let payment_status = 'no_payment_history';
                if (subs.active > 0) payment_status = 'active_paid';
                else if (invs.has_paid) payment_status = 'expired_paid';
                else if (invs.has_pending) payment_status = 'unpaid_lead';

                const coverage_status = !aud
                    ? 'missing_everywhere'
                    : (presentChannelIds.length === 0
                        ? 'missing_everywhere'
                        : (linkedChannels.length > 0 && presentChannelIds.length >= linkedChannels.length
                            ? 'all_channels'
                            : 'partial_channels'));

                return {
                    ...member,
                    is_bot: aud?.is_bot || false,
                    present_now: aud?.present_now || false,
                    channels_count: presentChannelIds.length,
                    total_channels: linkedChannels.length,
                    present_channel_titles: presentChannelTitles,
                    missing_channel_titles: missingChannelTitles,
                    coverage_status,
                    active_subscription_count: subs.active,
                    expired_subscription_count: subs.expired,
                    has_any_paid_invoice: invs.has_paid,
                    has_pending_invoice: invs.has_pending,
                    payment_status
                };
            });

            const summary = hydrated.reduce((stats, member) => {
                if (member.is_bot) {
                    stats.bots += 1;
                    return stats;
                }
                stats.total += 1;
                stats.humans += 1;
                if (member.payment_status === 'active_paid') stats.active_paid += 1;
                if (member.payment_status === 'expired_paid' || member.payment_status === 'expired_paid_inside') stats.expired_paid += 1;
                if (member.payment_status === 'unpaid_lead') stats.unpaid_leads += 1;
                if (member.payment_status === 'free_rider' || member.payment_status === 'expired_paid_inside') stats.free_riders += 1;
                if (member.coverage_status === 'all_channels') stats.covered_all += 1;
                if (member.coverage_status === 'partial_channels') stats.covered_partial += 1;
                if (member.coverage_status === 'missing_everywhere') stats.covered_none += 1;
                return stats;
            }, {
                total: count || 0,
                humans: 0,
                bots: 0,
                active_paid: 0,
                expired_paid: 0,
                unpaid_leads: 0,
                free_riders: 0,
                covered_all: 0,
                covered_partial: 0,
                covered_none: 0
            });

            res.json({ members: hydrated, summary });
        } catch (error) {
            console.error('Ошибка загрузки членов базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка загрузки членов базы клиентов' });
        }
    });

    router.post('/:id/members', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : [];
            const cleanedEntries = rawEntries
                .map(cleanEntry)
                .filter(Boolean);

            if (cleanedEntries.length === 0) {
                return res.status(400).json({ error: 'Нужен хотя бы один Telegram ID. Без него человек даже в рассылку нормально не полетит.' });
            }

            const deduped = new Map();
            for (const entry of cleanedEntries) {
                deduped.set(entry.tg_user_id, entry);
            }
            const dedupedIds = Array.from(deduped.keys());

            const { data: existing, error: existingError } = await supabase
                .from('client_base_members')
                .select('tg_user_id')
                .eq('owner_id', req.user.id)
                .eq('base_id', baseId)
                .in('tg_user_id', dedupedIds);

            if (existingError) throw existingError;

            const existingIds = new Set((existing || []).map((row) => String(row.tg_user_id)));

            const upsertPayload = Array.from(deduped.values()).map((entry) => ({
                owner_id: req.user.id,
                base_id: baseId,
                tg_user_id: entry.tg_user_id,
                username: entry.username || null,
                display_name: entry.display_name || null,
                source: entry.source
            }));

            const { error: upsertError } = await supabase
                .from('client_base_members')
                .upsert(upsertPayload, { onConflict: 'base_id,tg_user_id' });

            if (upsertError) throw upsertError;

            await supabase
                .from('client_bases')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', baseId)
                .eq('owner_id', req.user.id);

            res.json({
                received: rawEntries.length,
                inserted: dedupedIds.length - existingIds.size,
                updated: existingIds.size
            });
        } catch (error) {
            console.error('Ошибка добавления членов в базу клиентов:', error);
            res.status(500).json({ error: 'Ошибка добавления членов в базу клиентов' });
        }
    });

    router.delete('/:id/members/:memberId', authenticateUser, async (req, res) => {
        try {
            const { id: baseId, memberId } = req.params;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const { data, error } = await supabase
                .from('client_base_members')
                .delete({ count: 'exact' })
                .eq('id', memberId)
                .eq('base_id', baseId)
                .eq('owner_id', req.user.id);

            if (error) throw error;

            const removed = Array.isArray(data) ? data.length : 0;
            if (removed === 0) {
                return res.status(404).json({ error: 'Член базы не найден' });
            }

            await supabase
                .from('client_bases')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', baseId)
                .eq('owner_id', req.user.id);

            res.json({ id: memberId });
        } catch (error) {
            console.error('Ошибка удаления члена базы клиентов:', error);
            res.status(500).json({ error: 'Ошибка удаления члена базы клиентов' });
        }
    });

    return router;
}
