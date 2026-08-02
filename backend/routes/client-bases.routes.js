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
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
            const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

            let query = supabase
                .from('client_base_members')
                .select('id, tg_user_id, username, display_name, source, added_at', { count: 'exact' })
                .eq('owner_id', req.user.id)
                .eq('base_id', baseId)
                .order('added_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (search) {
                const like = `%${search}%`;
                query = query.or(`display_name.ilike.${like},username.ilike.${like},tg_user_id.ilike.${like}`);
            }

            const { data: members, error: membersError, count } = await query;
            if (membersError) throw membersError;

            res.json({
                members: members || [],
                summary: { total: count || 0 }
            });
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
