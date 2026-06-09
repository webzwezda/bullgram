import { Telegraf, Markup } from 'telegraf';
import crypto from 'crypto';

const activeAutopostBots = new Map();

function getInviteCode(botId) {
    return crypto.createHash('sha256').update(botId).digest('hex').substring(0, 12);
}

async function getAdminKeyboard(botId, tgUserId, supabase) {
    const { data: bot } = await supabase.from('autopost_bots').select('*').eq('id', botId).single();
    const { data: channels } = await supabase.from('channels').select('*').eq('autopost_bot_id', botId);
    
    let modeLabel = '🔄 Направление: ⚠️ Нет каналов';
    if (channels && channels.length > 0) {
        const activeModes = bot.active_modes || {};
        let activeId = activeModes[String(tgUserId)];
        let activeChannel = channels.find(c => String(c.tg_chat_id) === String(activeId));
        if (!activeChannel) {
            activeChannel = channels[0];
            activeModes[String(tgUserId)] = String(activeChannel.tg_chat_id);
            await supabase.from('autopost_bots').update({ active_modes: activeModes }).eq('id', botId);
        }
        modeLabel = `🔄 Направление: ${activeChannel.title} ${activeChannel.visibility === 'public' ? '📢' : '🔒'}`;
    }
    
    return Markup.keyboard([
        [modeLabel],
        ['➕ Добавить пост', '📋 Очередь'],
        ['📥 Предложки']
    ]).resize();
}

export class AutopostService {
    constructor(supabase) {
        this.supabase = supabase;
        this.guestSessions = new Map();
        this.mediaGroups = new Map();
        this.albumCache = new Map();
        this.splitCache = new Map();
        this.adminStates = new Map();
    }

    async createBot({ ownerId, botToken, targetChannelTgId, postsPerDay = 1, postingTimes = ['10:00'], username, adminTgId }) {
        const adminTgIds = adminTgId ? [Number(adminTgId)] : [];
        const { data, error } = await this.supabase
            .from('autopost_bots')
            .insert({
                owner_id: ownerId,
                bot_token: botToken,
                target_channel_tg_id: targetChannelTgId || null,
                posts_per_day: postsPerDay,
                posting_times: postingTimes,
                is_active: true,
                username: username || null,
                admin_tg_id: adminTgId ? String(adminTgId) : null,
                admin_tg_ids: adminTgIds,
                active_modes: {}
            })
            .select()
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

    async addPostItem({ botId, targetChannelId, fileIds, caption, status = 'queued' }) {
        const { count } = await this.supabase
            .from('autopost_items')
            .select('*', { count: 'exact', head: true })
            .eq('bot_id', botId);

        const { data, error } = await this.supabase
            .from('autopost_items')
            .insert({
                bot_id: botId,
                target_channel_id: targetChannelId || null,
                file_ids: fileIds || [],
                file_id: fileIds && fileIds.length > 0 ? fileIds[0] : null,
                caption: caption || '',
                status,
                sort_order: (count || 0) + 1
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async collapseQueue(botId, channelId) {
        if (!channelId) return;
        
        // Reset all scheduled posts to queued for this channel
        await this.supabase
            .from('autopost_items')
            .update({ status: 'queued', scheduled_at: null })
            .eq('bot_id', botId)
            .eq('target_channel_id', channelId)
            .eq('status', 'scheduled');
            
        // Re-run scheduling
        await this.scheduleNextBatch(botId, channelId);
    }

    async scheduleNextBatch(botId, channelId = null) {
        // If channelId is null, schedule for all channels of this bot
        if (!channelId) {
            const channels = await this.getBotChannels(botId);
            let total = 0;
            for (const ch of channels) {
                total += await this.scheduleNextBatch(botId, ch.tg_chat_id);
            }
            return total;
        }

        const { data: channel } = await this.supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId)
            .eq('tg_chat_id', channelId)
            .single();
        if (!channel) return 0;

        const postsPerDay = channel.posts_per_day || 1;
        const postingTimes = channel.posting_times || ['10:00'];

        // Находим последний запланированный/опубликованный пост для этого канала
        const { data: lastScheduled } = await this.supabase
            .from('autopost_items')
            .select('scheduled_at')
            .eq('bot_id', botId)
            .eq('target_channel_id', channel.tg_chat_id)
            .in('status', ['scheduled', 'posted'])
            .order('scheduled_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // Начинаем планирование со следующего дня (или сегодня, если нет запланированных)
        let startDate = new Date();
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(0, 0, 0, 0);

        if (lastScheduled?.scheduled_at) {
            const lastDate = new Date(lastScheduled.scheduled_at);
            const nextDay = new Date(lastDate);
            nextDay.setDate(nextDay.getDate() + 1);
            nextDay.setHours(0, 0, 0, 0);
            if (nextDay > startDate) {
                startDate = nextDay;
            }
        }

        // Находим нераспределённые посты для этого канала
        const { data: unscheduled } = await this.supabase
            .from('autopost_items')
            .select('*')
            .eq('bot_id', botId)
            .eq('target_channel_id', channel.tg_chat_id)
            .eq('status', 'queued')
            .order('sort_order', { ascending: true });

        if (!unscheduled || unscheduled.length === 0) return 0;

        let scheduled = 0;
        let currentDate = new Date(startDate);
        let itemIndex = 0;

        while (itemIndex < unscheduled.length) {
            for (let i = 0; i < postsPerDay && itemIndex < unscheduled.length; i++) {
                const timeStr = postingTimes[i % postingTimes.length] || '10:00';
                const [hours, minutes] = timeStr.split(':').map(Number);

                const scheduledAt = new Date(currentDate);
                scheduledAt.setHours(hours || 10, minutes || 0, 0, 0);

                await this.supabase
                    .from('autopost_items')
                    .update({ status: 'scheduled', scheduled_at: scheduledAt.toISOString() })
                    .eq('id', unscheduled[itemIndex].id);

                itemIndex++;
                scheduled++;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return scheduled;
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

    async markFailed(itemId) {
        await this.supabase
            .from('autopost_items')
            .update({ status: 'failed' })
            .eq('id', itemId);
    }

    async getStats(botId) {
        const { data: items } = await this.supabase
            .from('autopost_items')
            .select('status')
            .eq('bot_id', botId);

        const counts = { queued: 0, scheduled: 0, posted: 0, failed: 0 };
        for (const item of items || []) {
            counts[item.status] = (counts[item.status] || 0) + 1;
        }

        const { data: nextScheduled } = await this.supabase
            .from('autopost_items')
            .select('scheduled_at')
            .eq('bot_id', botId)
            .eq('status', 'scheduled')
            .order('scheduled_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        return { ...counts, nextScheduledAt: nextScheduled?.scheduled_at || null };
    }

    // --- Управление ботами ---

    startBot(botId, token) {
        if (activeAutopostBots.has(botId)) return;

        const bot = new Telegraf(token);
        this.registerHandlers(bot, botId);
        bot.launch()
            .then(() => console.log(`[Autopost] Бот ${botId} остановлен (polling)`))
            .catch(err => console.error(`[Autopost] Ошибка запуска/работы бота ${botId}:`, err.message));
        console.log(`[Autopost] Бот ${botId} запущен (polling)`);
        activeAutopostBots.set(botId, bot);
    }

    startWebhookBot(botId, token) {
        if (activeAutopostBots.has(botId)) return;

        const bot = new Telegraf(token);
        this.registerHandlers(bot, botId);
        activeAutopostBots.set(botId, bot);
        console.log(`[Autopost] Бот ${botId} готов к webhook`);
    }

    getBot(botId) {
        return activeAutopostBots.get(botId);
    }

    stopBot(botId) {
        const bot = activeAutopostBots.get(botId);
        if (!bot) return;
        try { bot.stop('SIGTERM'); } catch (e) {}
        activeAutopostBots.delete(botId);
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
        // Ловим добавление бота в канал/группу как администратора
        bot.on('my_chat_member', async (ctx) => {
            const chat = ctx.myChatMember.chat;
            const newStatus = ctx.myChatMember.new_chat_member.status;

            if (newStatus === 'administrator') {
                try {
                    const { data: botData } = await this.supabase
                        .from('autopost_bots')
                        .select('*')
                        .eq('id', botId)
                        .single();

                    if (botData?.owner_id) {
                        await this.supabase.from('channels').upsert({
                            owner_id: botData.owner_id,
                            autopost_bot_id: botId,
                            tg_chat_id: chat.id,
                            title: chat.title || String(chat.id),
                            chat_type: chat.type || 'channel',
                            username: chat.username || null,
                            visibility: chat.username ? 'public' : 'private',
                            last_visibility_check_at: new Date().toISOString()
                        }, { onConflict: 'tg_chat_id' });
                        console.log(`[Autopost] Канал ${chat.title || chat.id} привязан к боту ${botId}`);

                        // Уведомляем администраторов и обновляем их клавиатуру
                        const adminTgIds = botData.admin_tg_ids || [];
                        for (const adminId of adminTgIds) {
                            try {
                                const keyboard = await getAdminKeyboard(botId, adminId, this.supabase);
                                await ctx.telegram.sendMessage(adminId, `✅ Канал/группа "${chat.title || chat.id}" успешно привязана к автопостеру!`, keyboard);
                            } catch (e) {
                                console.error(`Failed to notify admin ${adminId} about channel addition:`, e.message);
                            }
                        }
                    }
                } catch (err) {
                    console.error('[Autopost] Ошибка сохранения канала:', err.message);
                }
            } else if (newStatus === 'left' || newStatus === 'kicked') {
                try {
                    await this.supabase.from('channels').delete().eq('tg_chat_id', chat.id).eq('autopost_bot_id', botId);
                    console.log(`[Autopost] Канал ${chat.title || chat.id} отвязан от бота ${botId}`);

                    const { data: botData } = await this.supabase
                        .from('autopost_bots')
                        .select('*')
                        .eq('id', botId)
                        .single();

                    if (botData) {
                        const adminTgIds = botData.admin_tg_ids || [];
                        for (const adminId of adminTgIds) {
                            try {
                                const keyboard = await getAdminKeyboard(botId, adminId, this.supabase);
                                await ctx.telegram.sendMessage(adminId, `⚠️ Канал/группа "${chat.title || chat.id}" отключена от автопостера.`, keyboard);
                            } catch (e) {
                                console.error(`Failed to notify admin ${adminId} about channel removal:`, e.message);
                            }
                        }
                    }
                } catch (err) {
                    console.error('[Autopost] Ошибка удаления канала:', err.message);
                }
            }
        });

        // /start Команда
        bot.start(async (ctx) => {
            const tgUserId = ctx.from.id;
            const { data: botData } = await this.supabase
                .from('autopost_bots')
                .select('*')
                .eq('id', botId)
                .single();
                
            if (!botData) {
                return ctx.reply('Ошибка: бот не найден в системе.');
            }
            
            const adminTgIds = botData.admin_tg_ids || [];
            const isOwnerOrAdmin = adminTgIds.map(String).includes(String(tgUserId));
            
            const startPayload = ctx.payload;
            
            if (isOwnerOrAdmin) {
                const keyboard = await getAdminKeyboard(botId, tgUserId, this.supabase);
                return ctx.reply('Добро пожаловать в админ-панель автопостера!', keyboard);
            }
            
            // Если админов вообще нет
            if (adminTgIds.length === 0) {
                return ctx.reply(
                    'Бот не настроен. Нажмите кнопку ниже, чтобы привязать его к вашему аккаунту.',
                    Markup.inlineKeyboard([
                        Markup.button.callback('✅ Я администратор', 'set_owner_admin')
                    ])
                );
            }
            
            // Если это инвайт для второго админа
            if (startPayload && startPayload.startsWith('add_admin_')) {
                const code = startPayload.replace('add_admin_', '');
                if (code === getInviteCode(botId)) {
                    if (!adminTgIds.map(String).includes(String(tgUserId))) {
                        adminTgIds.push(tgUserId);
                        await this.supabase
                            .from('autopost_bots')
                            .update({ admin_tg_ids: adminTgIds })
                            .eq('id', botId);
                    }
                    const keyboard = await getAdminKeyboard(botId, tgUserId, this.supabase);
                    return ctx.reply('Вы успешно добавлены в список администраторов бота!', keyboard);
                } else {
                    return ctx.reply('Недействительный код приглашения.');
                }
            }
            
            // Deep links для предложек от гостей
            if (startPayload && (startPayload === 'suggest_pub' || startPayload === 'suggest_priv')) {
                this.guestSessions.set(tgUserId, {
                    botId,
                    targetChannelType: startPayload === 'suggest_pub' ? 'public' : 'private'
                });
                return ctx.reply('Отлично! Пришлите фото (или альбом из нескольких фото) с текстом подписи, чтобы предложить пост в канал.');
            }
            
            // Обычное сообщение для гостя
            return ctx.reply('Привет! Вы можете предложить новость для публикации в наших каналах. Нажмите кнопку "Предложить новость" под постами в канале.');
        });

        // Callback привязки владельца бота
        bot.action('set_owner_admin', async (ctx) => {
            const tgUserId = ctx.from.id;
            const { data: botData } = await this.supabase
                .from('autopost_bots')
                .select('*')
                .eq('id', botId)
                .single();
            if (!botData) return ctx.answerCbQuery('Бот не найден');
            
            const adminTgIds = botData.admin_tg_ids || [];
            if (adminTgIds.length > 0) {
                return ctx.answerCbQuery('Администратор уже назначен.');
            }
            
            adminTgIds.push(tgUserId);
            await this.supabase
                .from('autopost_bots')
                .update({ 
                    admin_tg_ids: adminTgIds,
                    admin_tg_id: String(tgUserId) // для обратной совместимости
                })
                .eq('id', botId);
                
            await ctx.answerCbQuery('Вы успешно назначены администратором!');
            await ctx.editMessageText('Вы назначены администратором бота.');
            
            const keyboard = await getAdminKeyboard(botId, tgUserId, this.supabase);
            await ctx.reply('Панель управления активирована:', keyboard);
        });

        // Переключение направления
        bot.hears(/🔄 Направление/, async (ctx) => {
            const tgUserId = ctx.from.id;
            const { bot, isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.reply('Доступ запрещен.');
            
            const { data: channels } = await this.supabase
                .from('channels')
                .select('*')
                .eq('autopost_bot_id', botId);
                
            if (!channels || channels.length === 0) {
                return ctx.reply('Нет подключенных каналов. Пожалуйста, добавьте бота в каналы как администратора.');
            }
            
            const activeModes = bot.active_modes || {};
            const currentActive = activeModes[String(tgUserId)];
            
            let nextIndex = 0;
            if (currentActive) {
                const currentIndex = channels.findIndex(c => String(c.tg_chat_id) === String(currentActive));
                if (currentIndex !== -1) {
                    nextIndex = (currentIndex + 1) % channels.length;
                }
            }
            
            const nextChannel = channels[nextIndex];
            activeModes[String(tgUserId)] = String(nextChannel.tg_chat_id);
            
            await this.supabase
                .from('autopost_bots')
                .update({ active_modes: activeModes })
                .eq('id', botId);
                
            const keyboard = await getAdminKeyboard(botId, tgUserId, this.supabase);
            await ctx.reply(`Активный канал переключен на: ${nextChannel.title}`, keyboard);
        });

        bot.hears('➕ Добавить пост', async (ctx) => {
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.reply('Доступ запрещен.');
            ctx.reply('Просто отправьте мне фото или альбом с текстом подписи, и я подготовлю пост.');
        });

        // Показ очереди
        bot.hears('📋 Очередь', async (ctx) => {
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.reply('Доступ запрещен.');
            
            await ctx.reply(
                'Какую очередь показать?',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📢 Публичная', `show_queue:public`)],
                    [Markup.button.callback('🔒 Приватная', `show_queue:private`)]
                ])
            );
        });

        bot.action(/show_queue:(public|private)/, async (ctx) => {
            const type = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const { data: channels } = await this.supabase
                .from('channels')
                .select('*')
                .eq('autopost_bot_id', botId)
                .eq('visibility', type);
                
            if (!channels || channels.length === 0) {
                await ctx.answerCbQuery();
                return ctx.reply(`Канал типа "${type === 'public' ? 'публичный' : 'приватный'}" не подключен.`);
            }
            
            const channel = channels[0];
            
            const { data: items, error } = await this.supabase
                .from('autopost_items')
                .select('*')
                .eq('bot_id', botId)
                .eq('target_channel_id', channel.tg_chat_id)
                .in('status', ['queued', 'scheduled'])
                .order('sort_order', { ascending: true })
                .limit(10);
                
            await ctx.answerCbQuery();
            
            if (error || !items || items.length === 0) {
                return ctx.reply(`Очередь постов для канала "${channel.title}" пуста.`);
            }
            
            await ctx.reply(`📋 **Очередь постов (${type === 'public' ? 'Публичный' : 'Приватный'}):**`);
            
            for (const item of items) {
                const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                const statusText = item.status === 'scheduled' ? `📅 Запланирован на ${new Date(item.scheduled_at).toLocaleString('ru-RU')}` : '📦 В очереди';
                const buttons = [
                    [
                        Markup.button.callback('⚡️ Опубликовать', `post_now:${item.id}`),
                        Markup.button.callback('📝 Изменить текст', `edit_post_txt:${item.id}`)
                    ],
                    [
                        Markup.button.callback(type === 'public' ? '🔒 В Приват' : '📢 В Паблик', `move_post:${item.id}`),
                        Markup.button.callback('❌ Удалить', `del_post:${item.id}`)
                    ]
                ];
                
                if (fileId) {
                    await ctx.replyWithPhoto(fileId, {
                        caption: `${statusText}\n\n${item.caption || ''}`,
                        ...Markup.inlineKeyboard(buttons)
                    });
                } else {
                    await ctx.reply(`${statusText}\n\n${item.caption || ''}`, Markup.inlineKeyboard(buttons));
                }
            }
        });

        // Модерация предложек
        bot.hears('📥 Предложки', async (ctx) => {
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.reply('Доступ запрещен.');
            
            const { data: items, error } = await this.supabase
                .from('autopost_items')
                .select('*')
                .eq('bot_id', botId)
                .eq('status', 'suggested')
                .order('created_at', { ascending: true })
                .limit(10);
                
            if (error || !items || items.length === 0) {
                return ctx.reply('Предложка пуста.');
            }
            
            await ctx.reply(`📥 **Предложенные посты (модерация):**`);
            
            for (const item of items) {
                const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                
                const { data: channel } = await this.supabase
                    .from('channels')
                    .select('*')
                    .eq('tg_chat_id', item.target_channel_id)
                    .maybeSingle();
                    
                const destTitle = channel ? channel.title : 'Неизвестно';
                const buttons = [
                    [
                        Markup.button.callback('⚡️ Опубликовать сейчас', `sug_post_now:${item.id}`),
                        Markup.button.callback('📥 В общую очередь', `sug_approve:${item.id}`)
                    ],
                    [
                        Markup.button.callback('❌ Отклонить', `sug_reject:${item.id}`)
                    ]
                ];
                
                const captionText = `Канал назначения: ${destTitle}\n\n${item.caption || ''}`;
                
                if (fileId) {
                    await ctx.replyWithPhoto(fileId, {
                        caption: captionText,
                        ...Markup.inlineKeyboard(buttons)
                    });
                } else {
                    await ctx.reply(captionText, Markup.inlineKeyboard(buttons));
                }
            }
        });

        // Обработчики callback-кнопок управления очередью и предложкой
        bot.action(/post_now:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const { data: item } = await this.supabase
                .from('autopost_items')
                .select('*')
                .eq('id', itemId)
                .single();
                
            if (!item) return ctx.answerCbQuery('Пост не найден');
            
            try {
                const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                
                const { data: channel } = await this.supabase
                    .from('channels')
                    .select('*')
                    .eq('tg_chat_id', item.target_channel_id)
                    .maybeSingle();
                    
                let reply_markup = undefined;
                if (channel?.buttons_config && Array.isArray(channel.buttons_config) && channel.buttons_config.length > 0) {
                    reply_markup = {
                        inline_keyboard: [
                            channel.buttons_config.map(b => ({ text: b.text, url: b.url }))
                        ]
                    };
                }
                
                if (item.file_ids && item.file_ids.length > 1) {
                    const media = item.file_ids.map((fid, idx) => ({
                        type: 'photo',
                        media: fid,
                        caption: idx === 0 ? item.caption : undefined
                    }));
                    await ctx.telegram.sendMediaGroup(item.target_channel_id, media);
                } else if (fileId) {
                    await ctx.telegram.sendPhoto(item.target_channel_id, fileId, {
                        caption: item.caption || undefined,
                        reply_markup
                    });
                } else {
                    await ctx.telegram.sendMessage(item.target_channel_id, item.caption, {
                        reply_markup
                    });
                }
                
                await this.supabase
                    .from('autopost_items')
                    .update({ status: 'posted', posted_at: new Date().toISOString() })
                    .eq('id', itemId);
                    
                await ctx.answerCbQuery('Опубликовано!');
                try { await ctx.deleteMessage(); } catch (e) {}
                
                if (item.target_channel_id) {
                    await this.collapseQueue(botId, item.target_channel_id);
                }
            } catch (err) {
                console.error('[Autopost] Ошибка публикации:', err.message);
                await ctx.answerCbQuery('Ошибка: ' + err.message);
            }
        });

        bot.action(/edit_post_txt:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            await this.supabase
                .from('autopost_items')
                .update({ status: 'editing' })
                .eq('id', itemId);
                
            this.adminStates.set(tgUserId, {
                action: 'edit_caption',
                itemId,
                messageId: ctx.callbackQuery.message.message_id,
                chatId: ctx.chat.id
            });
            
            await ctx.reply('Введите новый текст для этого поста (или напишите "нет" для пустой подписи):');
            await ctx.answerCbQuery();
        });

        bot.action(/move_post:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const { data: item } = await this.supabase
                .from('autopost_items')
                .select('*')
                .eq('id', itemId)
                .single();
                
            if (!item) return ctx.answerCbQuery('Пост не найден');
            
            const { data: channels } = await this.supabase
                .from('channels')
                .select('*')
                .eq('autopost_bot_id', botId);
                
            if (!channels || channels.length < 2) {
                return ctx.answerCbQuery('Подключите оба канала для переноса.');
            }
            
            const otherChannel = channels.find(c => String(c.tg_chat_id) !== String(item.target_channel_id));
            if (!otherChannel) return ctx.answerCbQuery('Другой канал не найден');
            
            const oldChannelId = item.target_channel_id;
            
            await this.supabase
                .from('autopost_items')
                .update({ target_channel_id: otherChannel.tg_chat_id, status: 'queued', scheduled_at: null })
                .eq('id', itemId);
                
            await ctx.answerCbQuery(`Перенесено в ${otherChannel.title}`);
            try { await ctx.deleteMessage(); } catch (e) {}
            
            if (oldChannelId) await this.collapseQueue(botId, oldChannelId);
            await this.collapseQueue(botId, otherChannel.tg_chat_id);
        });

        bot.action(/del_post:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const { data: item } = await this.supabase
                .from('autopost_items')
                .select('target_channel_id')
                .eq('id', itemId)
                .single();
                
            await this.supabase
                .from('autopost_items')
                .delete()
                .eq('id', itemId);
                
            await ctx.answerCbQuery('Пост удален');
            try { await ctx.deleteMessage(); } catch (e) {}
            
            if (item?.target_channel_id) {
                await this.collapseQueue(botId, item.target_channel_id);
            }
        });

        bot.action(/sug_approve:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const { data: item } = await this.supabase
                .from('autopost_items')
                .select('*')
                .eq('id', itemId)
                .single();
                
            if (!item) return ctx.answerCbQuery('Пост не найден');
            
            await this.supabase
                .from('autopost_items')
                .update({ status: 'queued' })
                .eq('id', itemId);
                
            await ctx.answerCbQuery('Пост одобрен и добавлен в очередь');
            try { await ctx.deleteMessage(); } catch (e) {}
            
            if (item.target_channel_id) {
                await this.collapseQueue(botId, item.target_channel_id);
            }
        });

        bot.action(/sug_post_now:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const { data: item } = await this.supabase
                .from('autopost_items')
                .select('*')
                .eq('id', itemId)
                .single();
                
            if (!item) return ctx.answerCbQuery('Пост не найден');
            
            try {
                const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                
                const { data: channel } = await this.supabase
                    .from('channels')
                    .select('*')
                    .eq('tg_chat_id', item.target_channel_id)
                    .maybeSingle();
                    
                let reply_markup = undefined;
                if (channel?.buttons_config && Array.isArray(channel.buttons_config) && channel.buttons_config.length > 0) {
                    reply_markup = {
                        inline_keyboard: [
                            channel.buttons_config.map(b => ({ text: b.text, url: b.url }))
                        ]
                    };
                }
                
                if (item.file_ids && item.file_ids.length > 1) {
                    const media = item.file_ids.map((fid, idx) => ({
                        type: 'photo',
                        media: fid,
                        caption: idx === 0 ? item.caption : undefined
                    }));
                    await ctx.telegram.sendMediaGroup(item.target_channel_id, media);
                } else if (fileId) {
                    await ctx.telegram.sendPhoto(item.target_channel_id, fileId, {
                        caption: item.caption || undefined,
                        reply_markup
                    });
                } else {
                    await ctx.telegram.sendMessage(item.target_channel_id, item.caption, {
                        reply_markup
                    });
                }
                
                await this.supabase
                    .from('autopost_items')
                    .update({ status: 'posted', posted_at: new Date().toISOString() })
                    .eq('id', itemId);
                    
                await ctx.answerCbQuery('Опубликовано!');
                try { await ctx.deleteMessage(); } catch (e) {}
                
                if (item.target_channel_id) {
                    await this.collapseQueue(botId, item.target_channel_id);
                }
            } catch (err) {
                console.error('[Autopost] Ошибка публикации предложки:', err.message);
                await ctx.answerCbQuery('Ошибка: ' + err.message);
            }
        });

        bot.action(/sug_reject:(.+)/, async (ctx) => {
            const itemId = ctx.match[1];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            await this.supabase
                .from('autopost_items')
                .delete()
                .eq('id', itemId);
                
            await ctx.answerCbQuery('Пост отклонен');
            try { await ctx.deleteMessage(); } catch (e) {}
        });

        // Действия с альбомами (split / keep)
        bot.action(/album:(keep|split):(.+)/, async (ctx) => {
            const action = ctx.match[1];
            const cacheId = ctx.match[2];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const albumData = this.albumCache.get(cacheId);
            if (!albumData) return ctx.answerCbQuery('Данные альбома устарели');
            this.albumCache.delete(cacheId);
            
            if (action === 'keep') {
                await this.addPostItem({
                    botId,
                    targetChannelId: albumData.targetChannelId,
                    fileIds: albumData.photos,
                    caption: albumData.caption,
                    status: 'queued'
                });
                await this.collapseQueue(botId, albumData.targetChannelId);
                await ctx.answerCbQuery('Добавлено как альбом в очередь');
                await ctx.reply('✅ Альбом успешно добавлен в очередь.');
            } else {
                const splitCacheId = `${tgUserId}:${Date.now()}`;
                this.splitCache.set(splitCacheId, albumData);
                await ctx.reply(
                    `Альбом будет разделен на ${albumData.photos.length} постов. Продублировать подпись на каждый пост?`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Да, продублировать', `split_opt:dup:${splitCacheId}`)],
                        [Markup.button.callback('❌ Только на первом', `split_opt:first:${splitCacheId}`)]
                    ])
                );
                await ctx.answerCbQuery();
            }
            try { await ctx.deleteMessage(); } catch (e) {}
        });

        bot.action(/split_opt:(dup|first):(.+)/, async (ctx) => {
            const option = ctx.match[1];
            const splitCacheId = ctx.match[2];
            const tgUserId = ctx.from.id;
            const { isAdmin } = await this.getBotAdminContext(botId, tgUserId);
            if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
            
            const albumData = this.splitCache.get(splitCacheId);
            if (!albumData) return ctx.answerCbQuery('Данные устарели');
            this.splitCache.delete(splitCacheId);
            
            for (let i = 0; i < albumData.photos.length; i++) {
                const fileId = albumData.photos[i];
                const caption = (option === 'dup' || i === 0) ? albumData.caption : '';
                await this.addPostItem({
                    botId,
                    targetChannelId: albumData.targetChannelId,
                    fileIds: [fileId],
                    caption,
                    status: 'queued'
                });
            }
            
            await this.collapseQueue(botId, albumData.targetChannelId);
            await ctx.answerCbQuery('Посты добавлены');
            await ctx.reply(`✅ Разделено на ${albumData.photos.length} отдельных постов.`);
            try { await ctx.deleteMessage(); } catch (e) {}
        });

        // Редактирование текста подписи через текстовый ввод
        bot.on('text', async (ctx, next) => {
            const tgUserId = ctx.from.id;
            const state = this.adminStates.get(tgUserId);
            if (state && state.action === 'edit_caption') {
                this.adminStates.delete(tgUserId);
                
                let newCaption = ctx.message.text;
                if (newCaption.toLowerCase() === 'нет') {
                    newCaption = '';
                }
                
                await this.supabase
                    .from('autopost_items')
                    .update({ caption: newCaption, status: 'queued', scheduled_at: null })
                    .eq('id', state.itemId);
                    
                const { data: item } = await this.supabase
                    .from('autopost_items')
                    .select('*')
                    .eq('id', state.itemId)
                    .single();
                    
                if (item && item.target_channel_id) {
                    await this.collapseQueue(botId, item.target_channel_id);
                }
                
                try {
                    const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;
                    const statusText = `📦 В очереди (подпись изменена)`;
                    const buttons = [
                        [
                            Markup.button.callback('⚡️ Опубликовать', `post_now:${item.id}`),
                            Markup.button.callback('📝 Изменить текст', `edit_post_txt:${item.id}`)
                        ],
                        [
                            Markup.button.callback('❌ Удалить', `del_post:${item.id}`)
                        ]
                    ];
                    
                    if (fileId) {
                        await ctx.telegram.editMessageCaption(state.chatId, state.messageId, undefined, `${statusText}\n\n${newCaption}`, Markup.inlineKeyboard(buttons));
                    } else {
                        await ctx.telegram.editMessageText(state.chatId, state.messageId, undefined, `${statusText}\n\n${newCaption}`, Markup.inlineKeyboard(buttons));
                    }
                } catch (e) {
                    console.error('Failed to update inline message caption:', e.message);
                }
                
                try { await ctx.deleteMessage(); } catch (e) {}
                return ctx.reply('✅ Подпись успешно изменена!');
            }
            return next();
        });

        // Приём картинок и альбомов
        bot.on('photo', async (ctx) => {
            try {
                const tgUserId = ctx.from.id;
                const { bot, isAdmin } = await this.getBotAdminContext(botId, tgUserId);
                
                let guestSession = null;
                if (!isAdmin) {
                    guestSession = this.guestSessions.get(tgUserId);
                    if (!guestSession) {
                        return ctx.reply('Вы можете предложить новость для публикации в наших каналах. Используйте специальные ссылки "Предложить новость" под постами в каналах.');
                    }
                }
                
                const { data: channels } = await this.supabase
                    .from('channels')
                    .select('*')
                    .eq('autopost_bot_id', botId);
                    
                if (!channels || channels.length === 0) {
                    return ctx.reply('Сначала добавьте меня в канал как администратора!');
                }
                
                let targetChannel = null;
                if (isAdmin) {
                    const activeModes = bot.active_modes || {};
                    const activeId = activeModes[String(tgUserId)];
                    targetChannel = channels.find(c => String(c.tg_chat_id) === String(activeId)) || channels[0];
                } else {
                    const type = guestSession.targetChannelType;
                    targetChannel = channels.find(c => c.visibility === type) || channels[0];
                }
                
                const photo = ctx.message.photo[ctx.message.photo.length - 1];
                const mediaGroupId = ctx.message.media_group_id;
                
                if (mediaGroupId) {
                    let group = this.mediaGroups.get(mediaGroupId);
                    if (!group) {
                        group = {
                            photos: [],
                            captions: [],
                            timer: null
                        };
                        this.mediaGroups.set(mediaGroupId, group);
                    }
                    group.photos.push(photo.file_id);
                    if (ctx.message.caption) group.captions.push(ctx.message.caption);
                    
                    if (group.timer) clearTimeout(group.timer);
                    group.timer = setTimeout(async () => {
                        this.mediaGroups.delete(mediaGroupId);
                        const caption = group.captions.join('\n') || '';
                        
                        if (isAdmin) {
                            const cacheId = `${tgUserId}:${Date.now()}`;
                            this.albumCache.set(cacheId, { photos: group.photos, caption, targetChannelId: targetChannel.tg_chat_id });
                            await ctx.reply(
                                `📸 **Обнаружен альбом из ${group.photos.length} картинок!**`,
                                Markup.inlineKeyboard([
                                    [Markup.button.callback('📦 Опубликовать альбомом', `album:keep:${cacheId}`)],
                                    [Markup.button.callback('✂️ Разбить на отдельные посты', `album:split:${cacheId}`)]
                                ])
                            );
                        } else {
                            const autoAccept = targetChannel.auto_accept_suggestions || false;
                            const status = autoAccept ? 'queued' : 'suggested';
                            
                            await this.addPostItem({
                                botId,
                                targetChannelId: targetChannel.tg_chat_id,
                                fileIds: group.photos,
                                caption,
                                status
                            });
                            
                            if (autoAccept) {
                                await this.collapseQueue(botId, targetChannel.tg_chat_id);
                                await ctx.reply('🎉 Спасибо! Ваш пост принят и автоматически запланирован к публикации.');
                            } else {
                                await ctx.reply('🎉 Спасибо! Ваше предложение отправлено на модерацию администраторам.');
                                await this.notifyAdmins(bot, `📥 Получено новое предложение для канала "${targetChannel.title}"!`);
                            }
                        }
                    }, 1000);
                } else {
                    const caption = ctx.message.caption || '';
                    if (isAdmin) {
                        await this.addPostItem({
                            botId,
                            targetChannelId: targetChannel.tg_chat_id,
                            fileIds: [photo.file_id],
                            caption,
                            status: 'queued'
                        });
                        await this.collapseQueue(botId, targetChannel.tg_chat_id);
                        await ctx.reply(`✅ Картинка добавлена в очередь для канала "${targetChannel.title}".`);
                    } else {
                        const autoAccept = targetChannel.auto_accept_suggestions || false;
                        const status = autoAccept ? 'queued' : 'suggested';
                        
                        await this.addPostItem({
                            botId,
                            targetChannelId: targetChannel.tg_chat_id,
                            fileIds: [photo.file_id],
                            caption,
                            status
                        });
                        
                        if (autoAccept) {
                            await this.collapseQueue(botId, targetChannel.tg_chat_id);
                            await ctx.reply('🎉 Спасибо! Ваш пост принят и автоматически запланирован к публикации.');
                        } else {
                            await ctx.reply('🎉 Спасибо! Ваше предложение отправлено на модерацию администраторам.');
                            await this.notifyAdmins(bot, `📥 Получено новое предложение для канала "${targetChannel.title}"!`);
                        }
                    }
                }
            } catch (error) {
                console.error('[Autopost] Ошибка добавления:', error);
                await ctx.reply('❌ Не удалось обработать отправленный контент.');
            }
        });

        bot.command('stats', async (ctx) => {
            try {
                const stats = await this.getStats(botId);
                const next = stats.nextScheduledAt
                    ? new Date(stats.nextScheduledAt).toLocaleDateString('ru-RU')
                    : 'не запланировано';

                await ctx.reply(
                    `📊 **Статистика очереди**\n\n` +
                    `📦 В очереди: ${stats.queued}\n` +
                    `📅 Запланировано: ${stats.scheduled}\n` +
                    `✅ Опубликовано: ${stats.posted}\n` +
                    `❌ Ошибки: ${stats.failed}\n\n` +
                    `⏭ Следующий пост: ${next}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('[Autopost] Ошибка stats:', error);
            }
        });

        bot.command('schedule', async (ctx) => {
            try {
                const count = await this.scheduleNextBatch(botId);
                if (count === 0) {
                    await ctx.reply('Нет нераспределённых картинок для планирования.');
                } else {
                    await ctx.reply(`📅 Запланировано ${count} постов. Крон-задача опубликует их по расписанию.`);
                }
            } catch (error) {
                console.error('[Autopost] Ошибка schedule:', error);
                await ctx.reply('❌ Ошибка при планировании.');
            }
        });
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
