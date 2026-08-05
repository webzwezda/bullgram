import { Telegraf, Markup } from 'telegraf';
import crypto from 'crypto';
import { sendItemToChannel } from './autopost/sender.js';
import { getAdminKeyboard, showQueueForChannel } from './autopost/keyboard.js';
import {
    startAutopostBot,
    getAutopostBot,
    stopAutopostBot
} from './autopost/bot-lifecycle.js';
import {
    getNextSlots,
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

    async addItem(botId, { fileId, fileUniqueId, caption }) {
        // Legacy compatibility
        return this.addPostItem({
            botId,
            targetChannelId: null,
            fileIds: fileId ? [fileId] : [],
            caption,
            status: 'queued'
        });
    }

    async addPostItem({ botId, targetChannelId, targetChannelIds, fileIds, caption, status = 'queued', isSuggestion = false, mediaType, suggestedByTgId = null }) {
        // Resolve target channels: array takes precedence over scalar; both can be passed.
        // Multi-target fan-out: one logical post → N item rows grouped by post_batch_id.
        const scalar = targetChannelId != null ? [String(targetChannelId)] : [];
        const fromArray = Array.isArray(targetChannelIds) ? targetChannelIds.map(String) : [];
        const channelIds = [...new Set([...scalar, ...fromArray])];
        if (channelIds.length === 0) {
            throw new Error('addPostItem requires at least one target channel');
        }

        // Bug 7 fix: atomic sort_order. Было count+1, два одновременных добавления
        // получали одинаковый sort_order и порядок очереди становился недетерминированным.
        // Через max+1 в подзапросе гонка исчезает (PostgreSQL сериализует UPDATE/INSERT).
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
        const hasMedia = fileIds && fileIds.length > 0;
        const resolvedMediaType = mediaType || (hasMedia ? 'photo' : 'text');

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
            suggested_by_tg_id: suggestedByTgId ? String(suggestedByTgId) : null
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

    async getDueItems() {
        const now = new Date().toISOString();
        const { data, error } = await this.supabase
            .from('autopost_items')
            .select('*, autopost_bots!inner(*)')
            .eq('status', 'scheduled')
            .lte('scheduled_at', now)
            .order('scheduled_at', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async markPosted(itemId) {
        await this.supabase
            .from('autopost_items')
            .update({ status: 'posted', posted_at: new Date().toISOString() })
            .eq('id', itemId);
    }

    async markFailed(itemId, errorMessage = null) {
        await this.supabase
            .from('autopost_items')
            .update({
                status: 'failed',
                error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null
            })
            .eq('id', itemId);
    }

    async getStats(botId) {
        return getStatsImpl(this.supabase, botId);
    }

    // --- Album cache (БД-backed, Bug 4 fix) ---
    // Раньше жил в Map() на инстансе сервиса и терялся при рестарте —
    // между "альбом обнаружен" и кликом по кнопке keep/split.
    async setAlbumCache(cacheId, { botId, tgUserId, photos, mediaTypes = [], caption, targetChannelId, stage = 'pick' }) {
        const { error } = await this.supabase
            .from('autopost_album_cache')
            .upsert({
                cache_id: cacheId,
                bot_id: botId,
                tg_user_id: tgUserId,
                photos,
                media_types: mediaTypes,
                caption: caption || '',
                target_channel_id: targetChannelId,
                stage,
                created_at: new Date().toISOString()
            }, { onConflict: 'cache_id' });
        if (error) throw error;
    }

    async getAlbumCache(cacheId) {
        const { data, error } = await this.supabase
            .from('autopost_album_cache')
            .select('*')
            .eq('cache_id', cacheId)
            .maybeSingle();
        if (error) return null;
        if (!data) return null;
        return {
            photos: data.photos || [],
            mediaTypes: data.media_types || [],
            caption: data.caption || '',
            targetChannelId: data.target_channel_id,
            stage: data.stage
        };
    }

    async deleteAlbumCache(cacheId) {
        await this.supabase
            .from('autopost_album_cache')
            .delete()
            .eq('cache_id', cacheId);
    }

    async pruneExpiredAlbumCache() {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await this.supabase
            .from('autopost_album_cache')
            .delete()
            .lt('created_at', cutoff);
    }

    // --- Управление ботами ---

    /**
     * Публикует пост в канал и фиксирует результат на item.
     * Выносит общую логику publish + UPDATE, которая раньше дублировалась
     * в scheduler / post_now / sug_post_now. Дополнительно сохраняет
     * posted_message_ids для последующего lookup'а реакций.
     *
     * Если у channel.seed_reaction_emoji выставлено значение (например '❤️'),
     * бот сразу ставит эту реакцию на первое сообщение поста — social proof.
     * Боты не получают собственные message_reaction апдейты → это НЕ засчитывается
     * в reaction_total, счётчик остаётся чистым по реальным юзерам.
     */
    async publishItem(bot, item, channel, botUsername) {
        const messageIds = await sendItemToChannel(bot.telegram, item.target_channel_id, item, {
            channel,
            botUsername
        });

        // Реакцию ставим ДО записи в БД — она должна появиться вместе с постом,
        // а не после DB-апдейта. Если setMessageReaction упадёт (нет прав),
        // пост всё равно считается опубликованным.
        if (channel?.seed_reaction_emoji && messageIds && messageIds.length > 0) {
            try {
                await bot.telegram.setMessageReaction(item.target_channel_id, messageIds[0], [
                    { type: 'emoji', emoji: channel.seed_reaction_emoji }
                ]);
            } catch (e) {
                console.error('[Autopost] seed reaction failed (non-fatal):', e.message);
            }
        }

        await this.supabase
            .from('autopost_items')
            .update({
                status: 'posted',
                posted_at: new Date().toISOString(),
                posted_message_ids: messageIds || [],
                error_message: null
            })
            .eq('id', item.id);

        return messageIds || [];
    }

    /**
     * Применяет дельту реакций к посту по message_id.
     * Используется GIN-индексом posted_message_ids для O(1) lookup.
     * Возвращает обновлённый item id или null если пост не найден
     * (например, message_id не наш — пришёл для чужого сообщения).
     */
    async applyReactionDelta(messageId, delta) {
        if (!delta) return null;

        const { data, error } = await this.supabase.rpc('autopost_apply_reaction_delta', {
            p_message_id: Number(messageId),
            p_delta: delta
        });

        if (error) {
            console.error('[Autopost] applyReactionDelta failed:', error.message);
            return null;
        }
        return data || null;
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
