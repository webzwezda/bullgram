import { Telegraf, Markup } from 'telegraf';
import crypto from 'crypto';
import { sendItemToChannel, getFloodWaitSeconds } from './autopost/sender.js';
import { buildChecklistMessage, applyChecklistOps, computeChecklistStatus } from './autopost/checklist.js';
import { log } from './autopost/logger.js';
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
import { buildSeedReactionAttempts, buildSeedReactionPlans } from './autopost/handlers/reactions.js';
import { forwardToDiscussion } from './autopost/discussion.js';
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

    async addPostItem({ botId, targetChannelId, targetChannelIds, fileIds, caption, status = 'queued', isSuggestion = false, mediaType, checklistId = null, suggestedByTgId = null }) {
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
     * publishItem получает channel-объект от вызывающего. Scheduler передаёт
     * урезанный select (jobs/autopost-scheduler.job.js) без discussion-колонок —
     * добираем их точечным запросом, чтобы форвард в обсуждения работал на всех
     * путях публикации. Вызовы с полным select (*) идут как раньше, без запроса.
     */
    async resolveDiscussionChannel(item, channel) {
        if (channel && channel.discussion_forward_enabled !== undefined) return channel;
        try {
            const { data, error } = await this.supabase
                .from('channels')
                .select('discussion_forward_enabled, linked_chat_id')
                .eq('tg_chat_id', item.target_channel_id)
                .eq('autopost_bot_id', item.bot_id)
                .maybeSingle();
            if (error) throw error;
            if (!data) return channel;
            return {
                ...(channel || {}),
                discussion_forward_enabled: data.discussion_forward_enabled,
                linked_chat_id: data.linked_chat_id
            };
        } catch (e) {
            console.warn(`[Autopost] discussion channel lookup failed (channel=${item.target_channel_id}, non-fatal):`, e.message);
            return channel;
        }
    }

    /**
     * Публикует пост в канал и фиксирует результат на item.
     * Выносит общую логику publish + UPDATE, которая раньше дублировалась
     * в scheduler / post_now / sug_post_now. Дополнительно сохраняет
     * posted_message_ids для последующего lookup'а реакций.
     *
     * Если у канала включён discussion_forward_enabled и есть linked_chat_id,
     * форвардит опубликованные сообщения в группу обсуждений — так появляются
     * нативные комментарии. discussion_message_ids пишутся тем же UPDATE;
     * ошибка форварда публикацию не роняет.
     *
     * Если у channel.seed_reaction_emoji выставлено значение (например '❤'),
     * бот сразу ставит эту реакцию на первое сообщение поста — social proof.
     * Боты не получают собственные message_reaction апдейты → это НЕ засчитывается
     * в reaction_total, счётчик остаётся чистым по реальным юзерам.
     *
     * Чек-лист (media_type='checklist'): checklist+items грузятся ЗДЕСЬ (у sender
     * нет доступа к supabase) и прокидываются в рендер через item.options;
     * seed-реакция и форвард в обсуждения пропускаются — вторая живая клавиатура
     * в обсуждении дала бы чужой контекст callback'ов (решение 5 из плана).
     */
    async publishItem(bot, item, channel, botUsername, { claimed = false, actorSource = 'agent' } = {}) {
        const isChecklist = item.media_type === 'checklist';

        // Отменённый/удалённый список публиковать нельзя — строка уйдёт в failed у вызывающего.
        if (isChecklist) {
            const checklist = await this.loadChecklistScoped(item.bot_id, item.checklist_id);
            if (!checklist || checklist.cancelled_at) {
                throw new Error('CHECKLIST_UNAVAILABLE');
            }
            item.options = {
                checklist,
                items: await this.loadChecklistItems(checklist.id),
                showNames: await this.resolveChecklistShowNames(item.bot_id, item.target_channel_id)
            };
        }

        const messageIds = await sendItemToChannel(bot.telegram, item.target_channel_id, item, {
            channel,
            botUsername
        });

        // Реакцию ставим ДО записи в БД — она должна появиться вместе с постом,
        // а не после DB-апдейта. Если setMessageReaction упадёт (нет прав),
        // пост всё равно считается опубликованным.
        //
        // setMessageReaction ЗАМЕНЯЕТ предыдущий набор реакций бота на сообщении,
        // поэтому каждая попытка — один вызов с готовым набором. Премиум-канал
        // (channel.seed_reaction_premium) шлёт мультиреакцию 2-3 эмодзи одним
        // вызовом; при отказе деградируем по префиксам вниз до одиночного.
        // Не-премиум — прежние одиночные попытки. Список уже нормализован
        // (❤️ → ❤, без VS16 — иначе Telegram даёт REACTION_INVALID),
        // пустой/мусорный список → Telegram не вызываем вовсе.
        // Чек-листы — без seed-реакций (решение 6: реакции юзеров на списке не мешаем,
        // но и не провоцируем; best-of всё равно фильтрует по media_type).
        const seedPlans = isChecklist
            ? []
            : buildSeedReactionPlans(
                buildSeedReactionAttempts(channel?.seed_reaction_emoji),
                { premium: channel?.seed_reaction_premium === true }
            );
        if (seedPlans.length > 0 && messageIds && messageIds.length > 0) {
            let seeded = false;
            for (const plan of seedPlans) {
                try {
                    await bot.telegram.setMessageReaction(item.target_channel_id, messageIds[0], plan.map((emoji) => ({ type: 'emoji', emoji })));
                    seeded = true;
                    break;
                } catch (e) {
                    console.error(`[Autopost] seed reaction attempt failed (chat=${item.target_channel_id} message=${messageIds[0]} emojis="${plan.join(',')}"):`, e.message);
                }
            }
            if (!seeded) {
                console.error(`[Autopost] seed reaction не удалась ни одной попыткой из ${seedPlans.length} (chat=${item.target_channel_id} message=${messageIds[0]}) — проверь, что эмодзи разрешён в настройках реакций канала, а для мультиреакций — что бот реально премиум (non-fatal, пост опубликован)`);
            }
        }

        // Нативные ветки обсуждений: Bot API не создаёт тред при отправке в канал,
        // поэтому форвардим опубликованные сообщения в привязанную группу
        // обсуждений — Telegram связывает их, и в канале появляется нативная
        // кнопка «Перейти к обсуждению». Ошибка форварда НЕ роняет публикацию:
        // пост уже в канале, item не должен уйти в failed.
        // Чек-листы не форвардятся (решение 5): копия в обсуждении = вторая живая
        // клавиатура с чужим контекстом callback'ов.
        const discussionChannel = isChecklist ? null : await this.resolveDiscussionChannel(item, channel);
        let discussionIds = [];
        if (discussionChannel?.discussion_forward_enabled && discussionChannel?.linked_chat_id && messageIds && messageIds.length > 0) {
            try {
                discussionIds = await forwardToDiscussion(bot.telegram, item.target_channel_id, discussionChannel.linked_chat_id, messageIds);
            } catch (e) {
                // Частично успевшие форварды не теряем — иначе message_delete
                // не сможет убрать их копии из обсуждения.
                discussionIds = Array.isArray(e?.forwardedIds) ? e.forwardedIds : [];
                console.warn(`[Autopost] discussion forward failed (channel=${item.target_channel_id} discussion=${discussionChannel.linked_chat_id}, non-fatal, пост опубликован):`, e.message);
            }
        } else if (discussionChannel?.discussion_forward_enabled && !discussionChannel?.linked_chat_id) {
            console.warn(`[Autopost] discussion_forward_enabled включён, но linked_chat_id пуст (channel=${item.target_channel_id}) — перепривяжи группу: выключи и включи тумблер обсуждения`);
        }

        // claimed-путь (scheduler) финализирует только item, который ещё в 'sending':
        // если статус уже изменился (recovery забрал, ручная правка) — апдейт не пройдёт
        // и повторная отправка следующим тиком исключена. Ручные пути (post_now, MCP,
        // предложка) публикуют из 'queued'/'editing' без claim — им guard не нужен.
        const postedUpdate = this.supabase
            .from('autopost_items')
            .update({
                status: 'posted',
                posted_at: new Date().toISOString(),
                posted_message_ids: messageIds || [],
                discussion_message_ids: discussionIds || [],
                error_message: null
            })
            .eq('id', item.id);
        const { error: postedError } = await (claimed
            ? postedUpdate.eq('status', 'sending')
            : postedUpdate);
        if (postedError) console.error('[Autopost] mark posted failed:', postedError.message);

        // Лента событий чек-листа: агент читает историю (published) через state.
        // Ошибка записи non-fatal — список уже опубликован.
        if (isChecklist) {
            const { error: evError } = await this.supabase.from('autopost_checklist_events').insert({
                checklist_id: item.checklist_id,
                action: 'published',
                actor_source: actorSource === 'admin' ? 'admin' : 'agent'
            });
            if (evError) {
                log.error('checklist', 'published_event_failed', { botId: item.bot_id, checklistId: item.checklist_id, err: evError.message });
            }
            log.info('checklist', 'published', { botId: item.bot_id, checklistId: item.checklist_id, itemId: item.id, chatId: item.target_channel_id });
        }

        // create-post (MCP) читает оба списка для ответа; остальные вызовы
        // (scheduler, post_now, sug_post_now) возвращаемое значение игнорируют.
        return { messageIds: messageIds || [], discussionMessageIds: discussionIds || [] };
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

    // --- Чек-листы ---
    // Каждая загрузка чек-листа — строго по паре (id, bot_id): чужой checklist_id
    // под своим ботом — штатный NOT_FOUND (план: защита от IDOR).

    async loadChecklistScoped(botId, checklistId) {
        const { data, error } = await this.supabase
            .from('autopost_checklists')
            .select('*')
            .eq('id', checklistId)
            .eq('bot_id', botId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async loadChecklistItems(checklistId) {
        const { data, error } = await this.supabase
            .from('autopost_checklist_items')
            .select('*')
            .eq('checklist_id', checklistId)
            .order('position', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async getChecklistState(botId, checklistId, { includeEvents = false, eventsLimit = 20 } = {}) {
        const checklist = await this.loadChecklistScoped(botId, checklistId);
        if (!checklist) throw new Error('NOT_FOUND');
        const status = computeChecklistStatus(checklist);
        const state = {
            checklist: { ...checklist, status },
            items: await this.loadChecklistItems(checklistId)
        };
        if (includeEvents) {
            const { data, error } = await this.supabase
                .from('autopost_checklist_events')
                .select('*')
                .eq('checklist_id', checklistId)
                .order('created_at', { ascending: false })
                .limit(Math.min(Math.max(1, Number(eventsLimit) || 20), 100));
            if (error) throw error;
            state.events = data || [];
        }
        // Ленивое истечение (TTL, решение плана — без отдельной джобы): списку с
        // прошедшим expires_at снимаем клавиатуры при чтении state. Один заход на
        // чтение — removeChecklistKeyboards сам state не читает, рекурсии нет.
        // Best-effort: бот офлайн — тихий log.debug; ошибка Telegram/БД — log.debug
        // (перерисовки внутри уже non-fatal, истина в БД).
        if (status === 'expired') {
            const telegram = this.getBot(botId)?.telegram;
            if (!telegram) {
                log.debug('checklist', 'lazy_expiry_skip_no_bot', { botId, checklistId });
            } else {
                try {
                    await this.removeChecklistKeyboards(telegram, botId, checklistId);
                    log.info('checklist', 'lazy_expiry_keyboards_removed', { botId, checklistId });
                } catch (e) {
                    log.debug('checklist', 'lazy_expiry_keyboard_remove_failed', { botId, checklistId, err: e.message });
                }
            }
        }
        return state;
    }

    /**
     * Список чек-листов бота. Статус вычисляемый — фильтр применяется в коде
     * после fetch (масштаб мелкий, индекс (owner_id, created_at desc) покрывает).
     * Курсор = created_at ISO; строки с тем же created_at, что у курсора,
     * пропускаются — для этого масштаба приемлемо. Старые курсоры вида
     * `created_at|id` читаются: парсер берёт только половину до '|'.
     */
    async listChecklists(botId, { status, createdAfter, limit = 20, cursor } = {}) {
        const cappedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
        let query = this.supabase
            .from('autopost_checklists')
            .select('*')
            .eq('bot_id', botId)
            .order('created_at', { ascending: false });
        if (createdAfter) query = query.gte('created_at', new Date(createdAfter).toISOString());
        if (cursor) {
            const [createdAtIso] = String(cursor).split('|');
            if (createdAtIso) query = query.lt('created_at', createdAtIso);
        }
        const { data, error } = await query.limit(cappedLimit);
        if (error) throw error;
        const rows = data || [];
        const items = rows
            .map((row) => ({ ...row, status: computeChecklistStatus(row) }))
            .filter((row) => !status || row.status === status);
        const last = rows[rows.length - 1];
        return {
            items,
            nextCursor: rows.length === cappedLimit && last ? last.created_at : null
        };
    }

    /**
     * Правки опубликованного списка: add/rename/remove/reset. Отметки переживают
     * rename (перенос по item_id — семантика в applyChecklistOps, чистой функции).
     * После записи — перерисовка всех posted-копий; отменённый список править нельзя
     * (его клавиатуры уже сняты — перерисовка вернула бы их).
     * Кап общего числа: существующие пункты + добавляемые ≤ 25 (TOO_MANY_ITEMS).
     */
    async updateChecklist(botId, checklistId, { add, rename, remove, reset } = {}, actor = {}) {
        const checklist = await this.loadChecklistScoped(botId, checklistId);
        if (!checklist) throw new Error('NOT_FOUND');
        if (checklist.cancelled_at) throw new Error('CHECKLIST_CANCELLED');

        const items = await this.loadChecklistItems(checklistId);
        // Кап после add — здесь, ПОСЛЕ NOT_FOUND-проверки по паре (id, bot_id):
        // pre-load в вызывающих читал бы потенциально чужие строки до scope-гейта.
        if (items.length + (Array.isArray(add) ? add.length : 0) > 25) {
            throw new Error('TOO_MANY_ITEMS');
        }
        const { items: nextItems, events } = applyChecklistOps(items, { add, rename, remove, reset });
        const originalIds = new Set(items.map((it) => String(it.id)));

        if (reset === true) {
            const { error } = await this.supabase
                .from('autopost_checklist_items')
                .update({ is_checked: false, checked_by_tg_id: null, checked_by_name: null, checked_at: null })
                .eq('checklist_id', checklistId)
                .eq('is_checked', true);
            if (error) throw error;
        }

        for (const r of Array.isArray(rename) ? rename : []) {
            const { error } = await this.supabase
                .from('autopost_checklist_items')
                .update({ text: String(r?.text ?? '').trim() })
                .eq('id', r?.item_id)
                .eq('checklist_id', checklistId);
            if (error) throw error;
        }

        for (const rawId of Array.isArray(remove) ? remove : []) {
            const { error } = await this.supabase
                .from('autopost_checklist_items')
                .delete()
                .eq('id', rawId)
                .eq('checklist_id', checklistId);
            if (error) throw error;
        }

        const addedRows = nextItems.filter((it) => !originalIds.has(String(it.id)));
        if (addedRows.length > 0) {
            const { error } = await this.supabase.from('autopost_checklist_items').insert(
                addedRows.map((it) => ({
                    id: it.id,
                    checklist_id: checklistId,
                    bot_id: checklist.bot_id,
                    text: it.text,
                    position: it.position
                }))
            );
            if (error) throw error;
        }

        if (events.length > 0) {
            const { error } = await this.supabase.from('autopost_checklist_events').insert(
                events.map((ev) => ({
                    checklist_id: checklistId,
                    item_id: ev.item_id,
                    action: ev.action,
                    actor_source: actor?.source || 'agent',
                    actor_tg_id: actor?.tgId ?? null,
                    actor_name: actor?.name ?? null
                }))
            );
            if (error) throw error;
        }

        const bot = this.getBot(botId);
        if (bot?.telegram) {
            await this.rerenderChecklistPost(bot.telegram, botId, checklistId);
        } else {
            log.warn('checklist', 'rerender_skip_no_bot', { botId, checklistId });
        }

        return this.getChecklistState(botId, checklistId);
    }

    /**
     * Отмена списка: queued/scheduled-строки очереди удаляются (семантика del_post),
     * posted остаются в Telegram, но клавиатуры снимаются — тапы по закрытому
     * списку должны умереть. Статус 'cancelled' у items сознательно не вводим
     * (решение 9: scheduler/статистика ждут фиксированный набор статусов).
     */
    async cancelChecklist(botId, checklistId, actor = {}) {
        const checklist = await this.loadChecklistScoped(botId, checklistId);
        if (!checklist) throw new Error('NOT_FOUND');
        // Идемпотентность: повторный cancel (двойной тап, гонка колбэков) просто
        // возвращает состояние — без второго события и без правок клавиатур.
        if (checklist.cancelled_at) return this.getChecklistState(botId, checklistId);

        const { data: queuedRows } = await this.supabase
            .from('autopost_items')
            .select('target_channel_id')
            .eq('checklist_id', checklistId)
            .in('status', ['queued', 'scheduled']);
        const { error: delError } = await this.supabase
            .from('autopost_items')
            .delete()
            .eq('checklist_id', checklistId)
            .in('status', ['queued', 'scheduled']);
        if (delError) throw delError;

        const { error: updError } = await this.supabase
            .from('autopost_checklists')
            .update({ cancelled_at: new Date().toISOString() })
            .eq('id', checklistId)
            .eq('bot_id', botId);
        if (updError) throw updError;

        const { error: evError } = await this.supabase.from('autopost_checklist_events').insert({
            checklist_id: checklistId,
            action: 'cancelled',
            actor_source: actor?.source || 'agent',
            actor_tg_id: actor?.tgId ?? null,
            actor_name: actor?.name ?? null
        });
        if (evError) throw evError;

        log.info('checklist', 'cancelled', {
            botId,
            checklistId,
            queuedRemoved: queuedRows?.length || 0,
            actorSource: actor?.source || 'agent'
        });

        const affectedChannels = [...new Set((queuedRows || []).map((r) => String(r.target_channel_id)))];
        for (const cid of affectedChannels) {
            await this.collapseQueue(botId, cid);
        }

        const bot = this.getBot(botId);
        if (bot?.telegram) {
            await this.removeChecklistKeyboards(bot.telegram, botId, checklistId);
        } else {
            log.warn('checklist', 'cancel_keyboard_skip_no_bot', { botId, checklistId });
        }

        return this.getChecklistState(botId, checklistId);
    }

    /**
     * Per-chat lookup видимости канала: в публичных каналах имена из кнопок
     * убираем — кнопки видны всему интернету через t.me/s/ (решение 11).
     * Ошибка lookup'а или отсутствие строки канала → имена прячем
     * (fail-closed: приватность важнее атрибуции).
     */
    async resolveChecklistShowNames(botId, targetChannelId) {
        try {
            const { data, error } = await this.supabase
                .from('channels')
                .select('visibility')
                .eq('tg_chat_id', String(targetChannelId))
                .eq('autopost_bot_id', botId)
                .maybeSingle();
            if (error) throw error;
            if (!data) return false;
            return data.visibility !== 'public';
        } catch (e) {
            log.warn('checklist', 'visibility_lookup_failed', { botId, targetChannelId, err: e.message });
            return false;
        }
    }

    async loadChecklistRenderContext(botId, checklistId) {
        const checklist = await this.loadChecklistScoped(botId, checklistId);
        if (!checklist) return null;
        const { data: postedRows, error } = await this.supabase
            .from('autopost_items')
            .select('id, target_channel_id, posted_message_ids')
            .eq('checklist_id', checklistId)
            .eq('bot_id', botId)
            .eq('status', 'posted');
        if (error) throw error;
        return { checklist, items: await this.loadChecklistItems(checklistId), postedRows: postedRows || [] };
    }

    /**
     * Перерисовывает ВСЕ опубликованные копии чек-листа: свежий текст с прогрессом
     * + клавиатура. Per-chat ошибки non-fatal — истина в БД, клавиатура догонит
     * следующим тогглом. Один FLOOD_WAIT-ретай по retry_after (паттерн sender.js).
     */
    async rerenderChecklistPost(telegramClient, botId, checklistId) {
        const context = await this.loadChecklistRenderContext(botId, checklistId);
        if (!context) return;
        const { checklist, items, postedRows } = context;
        if (checklist.cancelled_at) {
            // Отменённый список клавиатуру не возвращает.
            return this.removeChecklistKeyboards(telegramClient, botId, checklistId);
        }
        const showNamesByChat = new Map();
        for (const row of postedRows) {
            const messageIds = Array.isArray(row.posted_message_ids) ? row.posted_message_ids : [];
            if (messageIds.length === 0) continue;
            if (!showNamesByChat.has(row.target_channel_id)) {
                showNamesByChat.set(row.target_channel_id, await this.resolveChecklistShowNames(botId, row.target_channel_id));
            }
            const { text, replyMarkup } = buildChecklistMessage(checklist, items, {
                showNames: showNamesByChat.get(row.target_channel_id)
            });
            for (const messageId of messageIds) {
                await this.applyEditWithFloodRetry(telegramClient, () =>
                    telegramClient.editMessageText(row.target_channel_id, messageId, undefined, text, { reply_markup: replyMarkup })
                , { botId, checklistId, chatId: row.target_channel_id, messageId, op: 'rerender' });
            }
        }
    }

    /** Снятие клавиатур у опубликованных копий (cancel): текст остаётся, кнопки умирают. */
    async removeChecklistKeyboards(telegramClient, botId, checklistId) {
        const context = await this.loadChecklistRenderContext(botId, checklistId);
        if (!context) return;
        for (const row of context.postedRows) {
            const messageIds = Array.isArray(row.posted_message_ids) ? row.posted_message_ids : [];
            for (const messageId of messageIds) {
                await this.applyEditWithFloodRetry(telegramClient, () =>
                    telegramClient.editMessageReplyMarkup(row.target_channel_id, messageId)
                , { botId, checklistId, chatId: row.target_channel_id, messageId, op: 'keyboard_remove' });
            }
        }
    }

    async applyEditWithFloodRetry(telegramClient, editFn, meta) {
        try {
            await editFn();
        } catch (err) {
            const wait = getFloodWaitSeconds(err);
            if (wait <= 0) {
                log.warn('checklist', 'render_failed', { ...meta, err: err.message });
                return;
            }
            // спим в хендлере бота: долгий FLOOD_WAIT заморозил бы все апдейты
            // инстанса; истина в БД — клавиатура догонит следующим тогглом
            const capped = Math.min(wait, 10);
            await new Promise((resolve) => setTimeout(resolve, capped * 1000));
            try {
                await editFn();
            } catch (retryErr) {
                log.warn('checklist', 'render_failed_after_flood_retry', { ...meta, waitSeconds: capped, err: retryErr.message });
            }
        }
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
