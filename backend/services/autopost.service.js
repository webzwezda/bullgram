import { Telegraf } from 'telegraf';

const activeAutopostBots = new Map();

export class AutopostService {
    constructor(supabase) {
        this.supabase = supabase;
    }

    async createBot({ ownerId, botToken, targetChannelTgId, postsPerDay = 1, postingTimes = ['10:00'], username, adminTgId }) {
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
                admin_tg_id: adminTgId || null
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

        // Запускаем бота — он начнёт ловить my_chat_member
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
            .select('id, tg_chat_id, title, chat_type, username')
            .eq('autopost_bot_id', botId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async addItem(botId, { fileId, fileUniqueId, caption }) {
        const { count } = await this.supabase
            .from('autopost_items')
            .select('*', { count: 'exact', head: true })
            .eq('bot_id', botId);

        const { data, error } = await this.supabase
            .from('autopost_items')
            .insert({
                bot_id: botId,
                file_id: fileId,
                file_unique_id: fileUniqueId || null,
                caption: caption || '',
                sort_order: (count || 0) + 1
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async scheduleNextBatch(botId) {
        const { data: bot } = await this.supabase
            .from('autopost_bots')
            .select('*')
            .eq('id', botId)
            .single();
        if (!bot || !bot.is_active) return 0;

        const postsPerDay = bot.posts_per_day || 1;
        const postingTimes = bot.posting_times || ['10:00'];

        // Находим последний запланированный пост
        const { data: lastScheduled } = await this.supabase
            .from('autopost_items')
            .select('scheduled_at')
            .eq('bot_id', botId)
            .in('status', ['scheduled', 'posted'])
            .order('scheduled_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // Начинаем планирование с завтрашнего дня
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

        // Находим unscheduled items
        const { data: unscheduled } = await this.supabase
            .from('autopost_items')
            .select('*')
            .eq('bot_id', botId)
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
        bot.launch().then(() => console.log(`[Autopost] Бот ${botId} запущен (polling)`));
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

    registerHandlers(bot, botId) {
        // Ловим добавление бота в канал/группу как администратора
        bot.on('my_chat_member', async (ctx) => {
            const chat = ctx.myChatMember.chat;
            const newStatus = ctx.myChatMember.new_chat_member.status;

            if (newStatus === 'administrator') {
                try {
                    const { data: botData } = await this.supabase
                        .from('autopost_bots')
                        .select('owner_id')
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
                    }
                } catch (err) {
                    console.error('[Autopost] Ошибка сохранения канала:', err.message);
                }
            } else if (newStatus === 'left' || newStatus === 'kicked') {
                try {
                    await this.supabase.from('channels').delete().eq('tg_chat_id', chat.id).eq('autopost_bot_id', botId);
                    console.log(`[Autopost] Канал ${chat.title || chat.id} отвязан от бота ${botId}`);
                } catch (err) {
                    console.error('[Autopost] Ошибка удаления канала:', err.message);
                }
            }
        });

        bot.start(async (ctx) => {
            const adminContext = await this.getBotAdminContext(botId);
            if (!adminContext) return ctx.reply('Бот не настроен.');

            await ctx.reply(
                `🖼 **Автопост-бот**\n\n` +
                `Скидывай мне картинки с подписями — я поставлю их в очередь.\n\n` +
                `Команды:\n` +
                `/stats — статистика очереди\n` +
                `/schedule — запланировать все нераспределённые\n` +
                `/done — показать статус`,
                { parse_mode: 'Markdown' }
            );
        });

        // Приём картинок
        bot.on('photo', async (ctx) => {
            try {
                const adminContext = await this.getBotAdminContext(botId);
                if (!adminContext?.isAdmin) {
                    return ctx.reply('Только администратор может добавлять картинки.');
                }

                const photo = ctx.message.photo[ctx.message.photo.length - 1]; // largest size
                const caption = ctx.message.caption || '';

                const item = await this.addItem(botId, {
                    fileId: photo.file_id,
                    fileUniqueId: photo.file_unique_id,
                    caption
                });

                const stats = await this.getStats(botId);
                await ctx.reply(
                    `✅ Картинка #${item.sort_order} добавлена в очередь.\n\n` +
                    `В очереди: ${stats.queued} | Запланировано: ${stats.scheduled} | Опубликовано: ${stats.posted}\n\n` +
                    `Отправь /schedule чтобы распланировать по дням.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('[Autopost] Ошибка добавления:', error);
                await ctx.reply('❌ Не удалось добавить картинку.');
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

    async getBotAdminContext(botId) {
        const { data: bot } = await this.supabase
            .from('autopost_bots')
            .select('owner_id, target_channel_tg_id')
            .eq('id', botId)
            .single();
        return bot || null;
    }
}
