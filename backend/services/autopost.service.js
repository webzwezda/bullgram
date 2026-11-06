import { Telegraf } from 'telegraf';
import crypto from 'crypto';
import {
    startAutopostBot,
    getAutopostBot,
    stopAutopostBot
} from './autopost/bot-lifecycle.js';
import {
    scheduleNextBatch as scheduleNextBatchImpl,
    collapseQueue as collapseQueueImpl,
    getStats as getStatsImpl
} from './autopost/queue.js';
import { registerAllHandlers } from './autopost/handlers/index.js';
import {
    setGuestSession,
    getGuestSession,
    deleteGuestSession,
    pruneExpiredGuestSessions
} from './autopost/sessions.js';
import {
    setAlbumCache as setAlbumCacheImpl,
    getAlbumCache as getAlbumCacheImpl,
    deleteAlbumCache as deleteAlbumCacheImpl,
    pruneExpiredAlbumCache as pruneExpiredAlbumCacheImpl,
    publishItem as publishItemImpl,
    applyReactionDelta as applyReactionDeltaImpl
} from './autopost/publish.js';
import {
    loadChecklistScoped as loadChecklistScopedImpl,
    loadChecklistItems as loadChecklistItemsImpl,
    getChecklistState as getChecklistStateImpl,
    listChecklists as listChecklistsImpl,
    updateChecklist as updateChecklistImpl,
    cancelChecklist as cancelChecklistImpl,
    resolveChecklistShowNames as resolveChecklistShowNamesImpl,
    loadChecklistRenderContext as loadChecklistRenderContextImpl,
    rerenderChecklistPost as rerenderChecklistPostImpl,
    removeChecklistKeyboards as removeChecklistKeyboardsImpl,
    applyEditWithFloodRetry as applyEditWithFloodRetryImpl
} from './autopost/checklist-ops.js';

export class AutopostService {
    constructor(supabase) {
        this.supabase = supabase;
        // mediaGroups: альбом сейчас собирается (буфер между сообщениями Telegram,
        // порядка 2 секунды). Живёт в памяти — переживает только текущий инстанс.
        this.mediaGroups = new Map();
        // adminStates: редактирование подписи (админ кликнул edit, ждём текст).
        // Ключение по tg_user_id, короткий TTL, хранение в памяти приемлемо —
        // рестарт просто сбросит статус 'editing' через stuck-editing cron.
        this.adminStates = new Map();
    }

    // --- Await text post state ---
    // Админ кликнул «📝 Текст» — бот ждёт следующее сообщение как текст поста.
    // TTL 10 минут — симметрично с STUCK_THRESHOLD_MINUTES для edit_caption.
    // Живёт в памяти (как edit_caption), при рестарте сбрасывается.
    setAwaitTextPost(tgUserId, { targetChannelId, targetChannelTitle }) {
        const prev = this.adminStates.get(tgUserId);
        if (prev?.timer) clearTimeout(prev.timer);
        const entry = {
            action: 'await_text_post',
            targetChannelId,
            targetChannelTitle,
            createdAt: Date.now()
        };
        entry.timer = setTimeout(() => {
            this.adminStates.delete(tgUserId);
        }, 10 * 60 * 1000);
        this.adminStates.set(tgUserId, entry);
    }

    // --- Await channel select state ---
    // Админ прислал контент (текст/медиа/альбом) — бот показал picker каналов.
    // TTL 10 минут — симметрично с await_text_post и edit_caption.
    // Живёт в памяти, при рестарте сбрасывается (контент придётся прислать заново).
    setAwaitChannelSelect(tgUserId, { content, selectedChannelIds, channels, pickerMessageId }) {
        const prev = this.adminStates.get(tgUserId);
        if (prev?.timer) clearTimeout(prev.timer);
        const entry = {
            action: 'await_channel_select',
            content,
            selectedChannelIds: selectedChannelIds.map(String),
            channels,
            pickerMessageId,
            createdAt: Date.now()
        };
        entry.timer = setTimeout(() => {
            this.adminStates.delete(tgUserId);
        }, 10 * 60 * 1000);
        this.adminStates.set(tgUserId, entry);
    }

    // --- Guest sessions (БД-backed, переживают рестарт) ---
    setGuestSession(botId, tgUserId, data) {
        return setGuestSession(this.supabase, { botId, tgUserId, ...data });
    }

    getGuestSession(botId, tgUserId) {
        return getGuestSession(this.supabase, botId, tgUserId);
    }

    deleteGuestSession(botId, tgUserId) {
        return deleteGuestSession(this.supabase, botId, tgUserId);
    }

    pruneExpiredGuestSessions() {
        return pruneExpiredGuestSessions(this.supabase);
    }

    async createBot({ ownerId, botToken, postsPerDay = 1, postingTimes = ['10:00'], username, adminTgId }) {
        const adminTgIds = adminTgId ? [Number(adminTgId)] : [];
        const { data, error } = await this.supabase
            .from('autopost_bots')
            .insert({
                owner_id: ownerId,
                bot_token: botToken,
                posts_per_day: postsPerDay,
                posting_times: postingTimes,
                is_active: true,
                username: username || null,
                admin_tg_ids: adminTgIds,
                active_modes: {},
                invite_secret: crypto.randomBytes(16).toString('hex')
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async regenerateInviteSecret(botId) {
        const { data, error } = await this.supabase
            .from('autopost_bots')
            .update({ invite_secret: crypto.randomBytes(16).toString('hex') })
            .eq('id', botId)
            .select('id, invite_secret')
            .single();
        if (error) throw error;
        return data;
    }

    async validateAndCreateBot({ ownerId, botToken, adminTgId }) {
        const tempBot = new Telegraf(botToken);
        const botInfo = await tempBot.telegram.getMe();
        if (!botInfo?.id) throw new Error('Не удалось проверить токен бота');

        const bot = await this.createBot({ ownerId, botToken, username: botInfo.username, adminTgId: adminTgId || null });

        // Запускаем бота — он начнёт polling
        this.startBot(bot.id, botToken);

        return { ...bot, bot_username: botInfo.username, bot_first_name: botInfo.first_name };
    }

    async updateBot(botId, updates) {
        const { data, error } = await this.supabase
            .from('autopost_bots')
            .update(updates)
            .eq('id', botId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async getBotChannels(botId) {
        const { data, error } = await this.supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async addPostItem({ botId, targetChannelId, targetChannelIds, fileIds, caption, status = 'queued', isSuggestion = false, mediaType, checklistId = null, suggestedByTgId = null, agentNote = null }) {
        // Resolve target channels: array takes precedence over scalar; both can be passed.
        // Multi-target fan-out: one logical post → N item rows grouped by post_batch_id.
        const scalar = targetChannelId != null ? [String(targetChannelId)] : [];
        const fromArray = Array.isArray(targetChannelIds) ? targetChannelIds.map(String) : [];
        const channelIds = [...new Set([...scalar, ...fromArray])];
        if (channelIds.length === 0) {
            throw new Error('addPostItem requires at least one target channel');
        }

        // sort_order НЕ атомарен: сначала select max(sort_order) по боту, затем insert
        // с max+1. Между select и insert конкурирующая вставка может успеть пройти —
        // тогда два поста получат одинаковый sort_order и порядок очереди станет
        // недетерминированным. На практике окно гонки узкое, отдельной сериализации нет.
        const { data: maxRow } = await this.supabase
            .from('autopost_items')
            .select('sort_order')
            .eq('bot_id', botId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .maybeSingle();
        const baseSort = (maxRow?.sort_order || 0) + 1;

        // Текстовые посты (без fileIds) получают media_type='text' явно,
        // чтобы не маскироваться под 'photo' и корректно исключаться из best-of.
        // Чек-лист всегда 'checklist' явно — не даём fallback'у съесть тип.
        const hasMedia = fileIds && fileIds.length > 0;
        const resolvedMediaType = checklistId ? 'checklist' : (mediaType || (hasMedia ? 'photo' : 'text'));

        const batchId = crypto.randomUUID();
        const rows = channelIds.map((cid, idx) => ({
            bot_id: botId,
            target_channel_id: cid,
            post_batch_id: batchId,
            file_ids: fileIds || [],
            file_id: hasMedia ? fileIds[0] : null,
            caption: caption || '',
            status,
            sort_order: baseSort + idx,
            is_suggestion: isSuggestion,
            media_type: resolvedMediaType,
            checklist_id: checklistId || null,
            suggested_by_tg_id: suggestedByTgId ? String(suggestedByTgId) : null,
            // Приватная заметка агента (не рендерится в Telegram) — одна на весь
            // batch: все target-каналы шарят один контекст поста.
            agent_note: agentNote || null
        }));

        const { data, error } = await this.supabase
            .from('autopost_items')
            .insert(rows)
            .select('*');
        if (error) throw error;
        return { batch_id: batchId, items: data };
    }

    async collapseQueue(botId, channelId) {
        return collapseQueueImpl(this.supabase, botId, channelId);
    }

    async scheduleNextBatch(botId, channelId = null, isSuggestion = null) {
        return scheduleNextBatchImpl(this.supabase, botId, channelId, isSuggestion);
    }

    async getStats(botId) {
        return getStatsImpl(this.supabase, botId);
    }

    // --- Album cache + публикация: реализация в autopost/publish.js ---

    async setAlbumCache(cacheId, opts) {
        return setAlbumCacheImpl(this, cacheId, opts);
    }

    async getAlbumCache(cacheId) {
        return getAlbumCacheImpl(this, cacheId);
    }

    async deleteAlbumCache(cacheId) {
        return deleteAlbumCacheImpl(this, cacheId);
    }

    async pruneExpiredAlbumCache() {
        return pruneExpiredAlbumCacheImpl(this);
    }

    async publishItem(bot, item, channel, botUsername, opts = {}) {
        return publishItemImpl(this, bot, item, channel, botUsername, opts);
    }

    async applyReactionDelta(messageId, delta) {
        return applyReactionDeltaImpl(this, messageId, delta);
    }

    // --- Чек-листы: реализация в autopost/checklist-ops.js ---

    async loadChecklistScoped(botId, checklistId) {
        return loadChecklistScopedImpl(this, botId, checklistId);
    }

    async loadChecklistItems(checklistId) {
        return loadChecklistItemsImpl(this, checklistId);
    }

    async getChecklistState(botId, checklistId, opts = {}) {
        return getChecklistStateImpl(this, botId, checklistId, opts);
    }

    async listChecklists(botId, opts = {}) {
        return listChecklistsImpl(this, botId, opts);
    }

    async updateChecklist(botId, checklistId, ops = {}, actor = {}) {
        return updateChecklistImpl(this, botId, checklistId, ops, actor);
    }

    async cancelChecklist(botId, checklistId, actor = {}) {
        return cancelChecklistImpl(this, botId, checklistId, actor);
    }

    async resolveChecklistShowNames(botId, targetChannelId) {
        return resolveChecklistShowNamesImpl(this, botId, targetChannelId);
    }

    async loadChecklistRenderContext(botId, checklistId) {
        return loadChecklistRenderContextImpl(this, botId, checklistId);
    }

    async rerenderChecklistPost(telegramClient, botId, checklistId) {
        return rerenderChecklistPostImpl(this, telegramClient, botId, checklistId);
    }

    async removeChecklistKeyboards(telegramClient, botId, checklistId) {
        return removeChecklistKeyboardsImpl(this, telegramClient, botId, checklistId);
    }

    async applyEditWithFloodRetry(telegramClient, editFn, meta) {
        return applyEditWithFloodRetryImpl(this, telegramClient, editFn, meta);
    }

    startBot(botId, token) {
        startAutopostBot(botId, token, (bot, id) => this.registerHandlers(bot, id));
    }

    getBot(botId) {
        return getAutopostBot(botId);
    }

    stopBot(botId) {
        stopAutopostBot(botId);
    }

    async notifyAdmins(botData, message) {
        const admins = botData.admin_tg_ids || [];
        const bot = this.getBot(botData.id);
        if (!bot) return;
        for (const adminId of admins) {
            try {
                await bot.telegram.sendMessage(adminId, message);
            } catch (e) {
                console.error(`Failed to notify admin ${adminId}:`, e.message);
            }
        }
    }

    registerHandlers(bot, botId) {
        registerAllHandlers(bot, this, botId);
    }

    async getBotAdminContext(botId, tgUserId) {
        const { data: bot } = await this.supabase
            .from('autopost_bots')
            .select('*')
            .eq('id', botId)
            .single();
        if (!bot) return null;
        
        const adminTgIds = bot.admin_tg_ids || [];
        const isAdmin = adminTgIds.map(String).includes(String(tgUserId));
        return { bot, isAdmin };
    }
}
