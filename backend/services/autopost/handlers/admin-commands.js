/**
 * Admin-команды: переключение направления, добавление поста, очередь, предложки.
 * Также /stats и /schedule bot-команды.
 */
import { Markup } from 'telegraf';
import { getAdminKeyboard, showQueueForChannel, suggestionInlineKeyboard } from '../keyboard.js';

export function registerAdminCommandsHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.hears(/🔄 Направление/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);

        if (!channels || channels.length === 0) {
            return ctx.reply('Нет подключенных каналов. Пожалуйста, добавьте бота в каналы как администратора.');
        }

        const activeModes = botData.active_modes || {};
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

        await supabase
            .from('autopost_bots')
            .update({ active_modes: activeModes })
            .eq('id', botId);

        const keyboard = await getAdminKeyboard(botId, tgUserId, supabase);
        await ctx.reply(`Активный канал переключен на: ${nextChannel.title}`, keyboard);
    });

    bot.hears('➕ Добавить пост', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');
        ctx.reply('Просто отправьте мне фото или альбом с текстом подписи, и я подготовлю пост.');
    });

    bot.hears('📋 Очередь', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);

        if (!channels || channels.length === 0) {
            return ctx.reply('Нет подключенных каналов. Пожалуйста, добавьте бота в каналы как администратора.');
        }

        const activeModes = botData.active_modes || {};
        const activeId = activeModes[String(tgUserId)];
        let activeChannel = channels.find(c => String(c.tg_chat_id) === String(activeId));
        if (!activeChannel) {
            activeChannel = channels[0];
        }

        await showQueueForChannel(ctx, botId, activeChannel, supabase);
    });

    bot.action(/show_queue:(public|private)/, async (ctx) => {
        const type = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId)
            .eq('visibility', type);

        if (!channels || channels.length === 0) {
            await ctx.answerCbQuery();
            return ctx.reply(`Канал типа "${type === 'public' ? 'публичный' : 'приватный'}" не подключен.`);
        }

        await ctx.answerCbQuery();
        await showQueueForChannel(ctx, botId, channels[0], supabase);
    });

    bot.hears('📥 Предложки', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: items, error } = await supabase
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

            const { data: channel } = await supabase
                .from('channels')
                .select('*')
                .eq('tg_chat_id', item.target_channel_id)
                .maybeSingle();

            const destTitle = channel ? channel.title : 'Неизвестно';
            const captionText = `Канал назначения: ${destTitle}\n\n${item.caption || ''}`;
            const inlineKeyboard = suggestionInlineKeyboard(item);

            if (fileId) {
                const type = item.media_type || 'photo';
                if (type === 'video') {
                    await ctx.replyWithVideo(fileId, { caption: captionText, ...inlineKeyboard });
                } else if (type === 'animation') {
                    await ctx.replyWithAnimation(fileId, { caption: captionText, ...inlineKeyboard });
                } else if (type === 'document') {
                    await ctx.replyWithDocument(fileId, { caption: captionText, ...inlineKeyboard });
                } else {
                    await ctx.replyWithPhoto(fileId, { caption: captionText, ...inlineKeyboard });
                }
            } else {
                await ctx.reply(captionText, inlineKeyboard);
            }
        }
    });

    bot.command('stats', async (ctx) => {
        try {
            const stats = await service.getStats(botId);
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
            const count = await service.scheduleNextBatch(botId);
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
