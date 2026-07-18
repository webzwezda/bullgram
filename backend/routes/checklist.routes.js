/**
 * Роуты семейных чеклистов.
 *
 * Два типа авторизации:
 *   - authenticateUser (session JWT) — для CRUD ботов, lists, web quick-add
 *   - authenticateIntegrationToken (bearer brapi_...) — для /push из AI-агентов
 *
 * Multi-tenant enforcement: ВСЕ запросы с конкретным bot_id фильтруем по owner_id.
 */

import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { authenticateIntegrationToken, createIntegrationToken, listIntegrationTokens, revokeIntegrationToken } from '../services/integration-tokens.service.js';
import { ChecklistService } from '../services/checklist/index.js';
import { reloadList } from '../services/checklist/lists.service.js';

export default function checklistRoutes(supabase) {
    const router = express.Router();
    const service = new ChecklistService(supabase);

    // ============================================================
    // CRUD ботов (session auth)
    // ============================================================

    router.get('/bots', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase.from('checklist_bots')
                .select('id, bot_username, bot_id_tg, display_name, is_active, created_at, updated_at')
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            res.json({ bots: data || [] });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Не удалось загрузить ботов' });
        }
    });

    router.post('/bots', authenticateUser, async (req, res) => {
        const botToken = String(req.body?.bot_token || '').trim();
        const displayName = String(req.body?.display_name || '').trim();
        if (!botToken) return res.status(400).json({ error: 'bot_token обязателен' });

        try {
            // Валидируем токен через Telegram
            let me;
            try {
                me = await ChecklistService.validateToken(botToken);
            } catch (e) {
                return res.status(400).json({
                    error: 'Невалидный bot_token. Проверь что скопировал токен целиком от @BotFather.'
                });
            }

            const { data: bot, error } = await supabase.from('checklist_bots')
                .insert({
                    owner_id: req.user.id,
                    bot_token: botToken,
                    bot_username: me.username,
                    bot_id_tg: me.id,
                    display_name: displayName || null
                })
                .select('id, bot_username, bot_id_tg, display_name, is_active, created_at')
                .single();

            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({
                        error: 'Этот бот уже зарегистрирован в системе. Один токен — один аккаунт.'
                    });
                }
                throw error;
            }

            // Стартуем polling
            service.startBot(bot.id, botToken, req.user.id);

            res.json({ bot });
        } catch (e) {
            console.error('[checklist] registerBot failed', e.message);
            res.status(500).json({ error: e.message || 'Не удалось создать бота' });
        }
    });

    router.get('/bots/:id', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase.from('checklist_bots')
                .select('id, bot_username, bot_id_tg, display_name, is_active, created_at, updated_at')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Бот не найден' });
            res.json({ bot: { ...data, is_running: Boolean(service.getBot(data.id)) } });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.patch('/bots/:id', authenticateUser, async (req, res) => {
        const updates = {};
        if (typeof req.body?.display_name === 'string') {
            updates.display_name = String(req.body.display_name).trim() || null;
        }
        if (typeof req.body?.is_active === 'boolean') {
            updates.is_active = req.body.is_active;
        }
        updates.updated_at = new Date().toISOString();

        try {
            const { data, error } = await supabase.from('checklist_bots')
                .update(updates)
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .select('id, bot_username, display_name, is_active, updated_at')
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Бот не найден' });

            // Sync lifecycle: если is_active=false — стопаем, если true — поднимаем
            if (updates.is_active === false) {
                service.stopBot(data.id);
            } else if (updates.is_active === true) {
                const { data: full } = await supabase.from('checklist_bots')
                    .select('bot_token').eq('id', data.id).single();
                if (full?.bot_token) service.startBot(data.id, full.bot_token, req.user.id);
            }

            res.json({ bot: data });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/bots/:id', authenticateUser, async (req, res) => {
        try {
            // Сначала стопаем polling
            service.stopBot(req.params.id);

            const { data, error } = await supabase.from('checklist_bots')
                .delete()
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .select('id')
                .maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Бот не найден' });

            res.json({ deleted: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/bots/:id/restart', authenticateUser, async (req, res) => {
        try {
            const { data: bot, error } = await supabase.from('checklist_bots')
                .select('id, bot_token, is_active')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            service.stopBot(bot.id);
            if (bot.is_active) {
                service.startBot(bot.id, bot.bot_token, req.user.id);
            }

            res.json({
                ok: true,
                isRunning: bot.is_active ? Boolean(service.getBot(bot.id)) : false
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ============================================================
    // Integration token для AI-агента (управление с сайта)
    // ============================================================

    router.get('/bots/:id/integration-tokens', authenticateUser, async (req, res) => {
        try {
            // Проверяем что бот принадлежит owner'у
            const { data: bot } = await supabase.from('checklist_bots')
                .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const tokens = await listIntegrationTokens(supabase, {
                ownerId: req.user.id,
                purpose: 'api'
            });
            // Метаданные: какой бот привязан
            const filtered = tokens
                .filter(t => t.metadata?.bot_id === req.params.id)
                .map(t => ({
                    id: t.id,
                    label: t.label,
                    token_prefix: t.token_prefix,
                    token_hint: t.token_hint,
                    can_reveal: t.can_reveal,
                    last_used_at: t.last_used_at,
                    created_at: t.created_at,
                    revoked_at: t.revoked_at
                }));
            res.json({ tokens: filtered });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/bots/:id/integration-tokens', authenticateUser, async (req, res) => {
        const label = String(req.body?.label || '').trim() || 'AI агент';
        try {
            // Проверяем ownership
            const { data: bot } = await supabase.from('checklist_bots')
                .select('id, bot_username').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            const { token, record } = await createIntegrationToken(supabase, {
                ownerId: req.user.id,
                label,
                purpose: 'api',
                scopes: ['api:use'],
                metadata: { bot_id: req.params.id }
            });
            res.json({
                token,
                record: {
                    id: record.id,
                    label: record.label,
                    token_prefix: record.token_prefix,
                    token_hint: record.token_hint,
                    created_at: record.created_at
                }
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ============================================================
    // Списки (history) + delete + retry
    // ============================================================

    router.get('/bots/:id/lists', authenticateUser, async (req, res) => {
        const limit = Math.min(Number(req.query?.limit || 50), 200);
        const offset = Math.max(Number(req.query?.offset || 0), 0);
        const status = req.query?.status;

        try {
            let query = supabase.from('checklist_lists')
                .select('id, chat_id, title, source, status, error_message, created_at, completed_at, checklist_items(id, checked)')
                .eq('bot_id', req.params.id)
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (status) query = query.eq('status', status);

            const { data, error } = await query;
            if (error) throw error;

            const lists = (data || []).map(l => ({
                id: l.id,
                chat_id: l.chat_id,
                title: l.title,
                source: l.source,
                status: l.status,
                error_message: l.error_message,
                created_at: l.created_at,
                completed_at: l.completed_at,
                items_total: (l.checklist_items || []).length,
                items_checked: (l.checklist_items || []).filter(i => i.checked).length
            }));
            res.json({ lists });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/lists/:id', authenticateUser, async (req, res) => {
        try {
            const result = await service.deleteList({
                listId: req.params.id,
                ownerId: req.user.id
            });
            if (!result.deleted) return res.status(404).json({ error: 'Список не найден' });
            res.json({ deleted: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/lists/:id/retry', authenticateUser, async (req, res) => {
        try {
            const { data: list, error } = await supabase.from('checklist_lists')
                .select('id, bot_id, chat_id, title, status, source_message_id, checklist_items(id, text, position)')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!list) return res.status(404).json({ error: 'Список не найден' });
            if (list.status === 'posted') return res.status(400).json({ error: 'Список уже опубликован' });

            const bot = service.getBot(list.bot_id);
            if (!bot) return res.status(409).json({ error: 'Бот не запущен' });

            // Удаляем старую failed-запись и создаём новую через createAndPost
            const { data: botRow } = await supabase.from('checklist_bots')
                .select('owner_id').eq('id', list.bot_id).single();

            const items = (list.checklist_items || [])
                .sort((a, b) => a.position - b.position)
                .map(i => i.text);

            // Сначала удаляем старую (со всеми items каскадом)
            await supabase.from('checklist_lists').delete().eq('id', list.id);

            const newList = await service.createList({
                ownerId: botRow.owner_id,
                botId: list.bot_id,
                bot,
                chatId: list.chat_id,
                title: list.title,
                items,
                source: 'agent', // retry = как агентский постинг
                sourceMessageId: list.source_message_id
            });
            res.json({ list: newList });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ============================================================
    // Quick-add с сайта (session auth)
    // ============================================================

    router.post('/bots/:id/push', authenticateUser, async (req, res) => {
        const chatId = Number(req.body?.chat_id);
        const title = String(req.body?.title || '').trim();
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        const rawText = String(req.body?.text || '').trim();

        if (!chatId || !Number.isFinite(chatId)) {
            return res.status(400).json({ error: 'chat_id обязателен (число)' });
        }
        if (!items && !rawText) {
            return res.status(400).json({ error: 'Нужны items[] или text со списком' });
        }

        try {
            const { data: bot, error } = await supabase.from('checklist_bots')
                .select('id, owner_id, is_active, bot_token')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            let telegrafBot = service.getBot(bot.id);
            if (!telegrafBot) {
                if (!bot.is_active) return res.status(409).json({ error: 'Бот не активен' });
                service.startBot(bot.id, bot.bot_token, req.user.id);
                telegrafBot = service.getBot(bot.id);
            }
            if (!telegrafBot) return res.status(500).json({ error: 'Не удалось запустить бота' });

            const list = await service.createList({
                ownerId: req.user.id,
                botId: bot.id,
                bot: telegrafBot,
                chatId,
                title: title || undefined,
                items: items || undefined,
                rawText: items ? undefined : rawText,
                source: 'web'
            });
            res.json({ list });
        } catch (e) {
            console.error('[checklist] web push failed', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ============================================================
    // Webhook для AI-агентов (bearer auth via integration token)
    // ============================================================

    router.post('/push', async (req, res) => {
        let auth;
        try {
            auth = await authenticateIntegrationToken(supabase, {
                authorizationHeader: req.headers.authorization,
                requiredScopes: ['api:use'],
                purpose: 'api',
                requestIp: req.ip || req.headers['x-forwarded-for'] || ''
            });
        } catch (e) {
            return res.status(e.statusCode || 401).json({ error: e.message });
        }
        if (!auth?.ownerId) return res.status(401).json({ error: 'Invalid token' });

        const ownerId = auth.ownerId;
        const botId = String(req.body?.bot_id || '').trim();
        const chatId = Number(req.body?.chat_id);
        const title = String(req.body?.title || '').trim();
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        const rawText = String(req.body?.text || '').trim();
        const replyToMessageId = req.body?.reply_to_message_id ? Number(req.body.reply_to_message_id) : null;

        if (!botId) return res.status(400).json({ error: 'bot_id обязателен' });
        if (!chatId || !Number.isFinite(chatId)) return res.status(400).json({ error: 'chat_id обязателен' });
        if (!items && !rawText) return res.status(400).json({ error: 'Нужны items[] или text' });

        try {
            // Проверяем что бот принадлежит этому owner'у (integration token → owner)
            const { data: bot, error } = await supabase.from('checklist_bots')
                .select('id, bot_token, is_active')
                .eq('id', botId)
                .eq('owner_id', ownerId)
                .maybeSingle();
            if (error) throw error;
            if (!bot) return res.status(404).json({ error: 'Бот не найден' });

            let telegrafBot = service.getBot(bot.id);
            if (!telegrafBot) {
                if (!bot.is_active) return res.status(409).json({ error: 'Бот не активен' });
                service.startBot(bot.id, bot.bot_token, ownerId);
                telegrafBot = service.getBot(bot.id);
            }
            if (!telegrafBot) return res.status(500).json({ error: 'Не удалось запустить бота' });

            const list = await service.createList({
                ownerId,
                botId: bot.id,
                bot: telegrafBot,
                chatId,
                title: title || undefined,
                items: items || undefined,
                rawText: items ? undefined : rawText,
                source: 'agent',
                replyToMessageId
            });
            res.json({ list: { id: list.id, status: list.status, message_id: list.message_id } });
        } catch (e) {
            console.error('[checklist] agent push failed', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}
