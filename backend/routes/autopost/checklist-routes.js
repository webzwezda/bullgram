import { rateLimit } from '../../middlewares/rate-limit.middleware.js';
import { validateChecklistInput, renderChecklistSummary } from '../../services/autopost/checklist.js';
import { isValidUuid } from '../../shared/utils.js';

export function registerChecklistRoutes(router, deps) {
    const { supabase, service, findOwnedBot, mapChecklistError } = deps;

    // --- Чек-листы автопостера ---
    // Thin-ручки над Phase-1 сервисом (services/autopost.service.js): owner-проверка
    // через findOwnedBot, дальше сервис. Те же сценарии, что у MCP-инструментов
    // checklist-* (mcp/tools/autopost/), но под JWT админки (created_by='admin').

    // Список чек-листов бота (фильтр status/limit/cursor)
    router.get('/bots/:botId/checklists', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const { status, limit, cursor } = req.query;
            const { items, nextCursor } = await service.listChecklists(req.params.botId, {
                status: status || undefined,
                limit: Number(limit) || 20,
                cursor: cursor || undefined
            });
            res.json({ items, next_cursor: nextCursor });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Создать чек-лист и поставить в очередь на каналы бота.
    // Rate-limit: 30 в минуту, один инстанс на create/PATCH/cancel — эти ручки
    // пишут несколько таблиц и дёргают перерисовку клавиатур.
    const checklistRateLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });
    router.post('/bots/:botId/checklists', checklistRateLimit, async (req, res) => {
        try {
            const { items, title, channelIds, expiresAt, dedupKey } = req.body;

            const verdict = validateChecklistInput({ title, items, dedupKey });
            if (!verdict.ok) return res.status(400).json({ error: verdict.error });

            const bot = await findOwnedBot(req.params.botId, req.user.id);
            if (!bot) return res.status(403).json({ error: 'Нет доступа' });

            // Каналы обязаны быть подключены к этому боту (тот же паттерн, что в create-post).
            const ids = [...new Set((Array.isArray(channelIds) ? channelIds : []).map(String))];
            if (ids.length === 0) return res.status(400).json({ error: 'Нужен хотя бы один канал' });
            const { data: channels, error: chErr } = await supabase
                .from('channels')
                .select('id, tg_chat_id')
                .in('tg_chat_id', ids)
                .eq('autopost_bot_id', req.params.botId);
            if (chErr) throw chErr;
            const found = new Set((channels || []).map((c) => String(c.tg_chat_id)));
            const missing = ids.filter((id) => !found.has(id));
            if (missing.length > 0) {
                return res.status(400).json({ error: `Каналы не подключены к боту: ${missing.join(', ')}` });
            }

            let expiresAtValue = null;
            if (expiresAt) {
                const d = new Date(expiresAt);
                if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'expiresAt должен быть ISO 8601 датой' });
                expiresAtValue = d.toISOString();
            }
            const dedupKeyValue = dedupKey ? String(dedupKey).trim() : null;
            const titleValue = String(title || '').trim();

            // dedup: повторное создание с тем же ключом возвращает существующий список.
            if (dedupKeyValue) {
                const { data: existing } = await supabase
                    .from('autopost_checklists')
                    .select('*')
                    .eq('bot_id', req.params.botId)
                    .eq('dedup_key', dedupKeyValue)
                    .maybeSingle();
                if (existing) return res.json({ checklist: existing, already_exists: true });
            }

            const { data: checklist, error: insErr } = await supabase
                .from('autopost_checklists')
                .insert({
                    owner_id: req.user.id,
                    bot_id: req.params.botId,
                    title: titleValue,
                    created_by: 'admin',
                    expires_at: expiresAtValue,
                    dedup_key: dedupKeyValue
                })
                .select()
                .single();
            if (insErr) {
                // Гонка dedup: параллельный create успел — возвращаем существующий.
                if (insErr.code === '23505' && dedupKeyValue) {
                    const { data: existing } = await supabase
                        .from('autopost_checklists')
                        .select('*')
                        .eq('bot_id', req.params.botId)
                        .eq('dedup_key', dedupKeyValue)
                        .maybeSingle();
                    if (existing) return res.json({ checklist: existing, already_exists: true });
                }
                throw insErr;
            }

            const itemTexts = items.map((raw) => String(raw ?? '').trim());
            const { error: itemsErr } = await supabase.from('autopost_checklist_items').insert(
                itemTexts.map((text, idx) => ({ checklist_id: checklist.id, bot_id: req.params.botId, text, position: idx }))
            );
            if (itemsErr) throw itemsErr;

            // Событие created с атрибуцией админа. Best-effort: список уже создан.
            const { error: evErr } = await supabase.from('autopost_checklist_events').insert({
                checklist_id: checklist.id,
                action: 'created',
                actor_source: 'admin'
            });
            if (evErr) console.error('[Autopost] checklist created event failed:', evErr.message);

            // Публикация: строка очереди на каждый канал, ближайшие слоты через collapseQueue.
            await service.addPostItem({
                botId: req.params.botId,
                targetChannelIds: ids,
                fileIds: [],
                caption: titleValue,
                status: 'queued',
                checklistId: checklist.id
            });
            for (const cid of ids) {
                await service.collapseQueue(req.params.botId, cid);
            }

            res.json({ checklist: { ...checklist, items_count: itemTexts.length } });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Состояние чек-листа: пункты + кто отметил + summary
    router.get('/bots/:botId/checklists/:checklistId', async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const state = await service.getChecklistState(req.params.botId, req.params.checklistId);
            res.json({
                checklist: state.checklist,
                items: state.items,
                summary: renderChecklistSummary(state.checklist, state.items)
            });
        } catch (err) {
            const mapped = mapChecklistError(err);
            if (mapped) return res.status(mapped.status).json({ error: mapped.error });
            res.status(500).json({ error: err.message });
        }
    });

    // Правка чек-листа: add/rename/remove/reset без потери отметок
    router.patch('/bots/:botId/checklists/:checklistId', checklistRateLimit, async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const { add, rename, remove, reset } = req.body;
            if (!Array.isArray(add) && !Array.isArray(rename) && !Array.isArray(remove) && reset !== true) {
                return res.status(400).json({ error: 'Нужна хотя бы одна правка: add, rename, remove или reset' });
            }
            if (Array.isArray(add) && add.length > 0) {
                const verdict = validateChecklistInput({ items: add });
                if (!verdict.ok) return res.status(400).json({ error: verdict.error });
            }
            // Per-op валидация — зеркало MCP checklist_update.
            if (Array.isArray(rename)) {
                for (const r of rename) {
                    if (!isValidUuid(r?.item_id)) return res.status(422).json({ error: 'item_id должен быть UUID' });
                    const text = String(r?.text ?? '').trim();
                    if (text.length < 1 || text.length > 100) return res.status(422).json({ error: 'Текст пункта 1–100 символов' });
                }
            }
            if (Array.isArray(remove)) {
                for (const rawId of remove) {
                    if (!isValidUuid(rawId)) return res.status(422).json({ error: 'item_id должен быть UUID' });
                }
            }
            const state = await service.updateChecklist(
                req.params.botId,
                req.params.checklistId,
                { add, rename, remove, reset },
                { source: 'admin' }
            );
            res.json({
                checklist: state.checklist,
                items: state.items,
                summary: renderChecklistSummary(state.checklist, state.items)
            });
        } catch (err) {
            const mapped = mapChecklistError(err);
            if (mapped) return res.status(mapped.status).json({ error: mapped.error });
            res.status(500).json({ error: err.message });
        }
    });

    // Закрыть чек-лист: клавиатуры снимаются, несобранные строки очереди удаляются
    router.post('/bots/:botId/checklists/:checklistId/cancel', checklistRateLimit, async (req, res) => {
        try {
            if (!(await findOwnedBot(req.params.botId, req.user.id))) {
                return res.status(403).json({ error: 'Нет доступа' });
            }
            const state = await service.cancelChecklist(req.params.botId, req.params.checklistId, { source: 'admin' });
            res.json({ checklist: state.checklist });
        } catch (err) {
            const mapped = mapChecklistError(err);
            if (mapped) return res.status(mapped.status).json({ error: mapped.error });
            res.status(500).json({ error: err.message });
        }
    });
}
