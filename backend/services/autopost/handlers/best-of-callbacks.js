/**
 * Callback'ы подборки "Лучшее за месяц":
 *   bestof:pub:YYYY-MM  — опубликовать в активный канал
 *   bestof:prev:YYYY-MM — предпросмотр в чат админа (без публикации в канал)
 *   bestof:cancel       — убрать inline-кнопки предпросмотра (no-op для данных)
 *
 * Активный канал берётся из active_modes[tgUserId] с fallback на channels[0].
 * Границы месяца — в channel.timezone (Europe/Moscow, Asia/Vladivostok, ...).
 */
import { Markup } from 'telegraf';
import { composeBestOfMonth, publishBestOf, formatMonthLabel } from '../best-of.js';
import { log } from '../logger.js';

export function registerBestOfCallbacksHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.action(/bestof:pub:(\d{4})-(\d{2})/, async (ctx) => {
        const year = parseInt(ctx.match[1], 10);
        const month = parseInt(ctx.match[2], 10);
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const channel = await resolveActiveChannel(botData, tgUserId);
        if (!channel) {
            await ctx.answerCbQuery('Нет подключённых каналов');
            return ctx.reply('Сначала подключите канал и добавьте бота туда как администратора.');
        }

        try {
            const { items, totalWithReactions } = await composeBestOfMonth(supabase, botId, channel.tg_chat_id, year, month, {
                timezone: channel.timezone
            });
            if (items.length === 0) {
                await ctx.answerCbQuery('Нет данных за этот месяц');
                return ctx.reply(`За ${formatMonthLabel(year, month)} постов с реакциями в канале «${channel.title}» ещё нет.`);
            }

            await publishBestOf(bot, channel.tg_chat_id, items, { year, month });
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.answerCbQuery('Опубликовано!');
            await ctx.reply(`✅ Лучшее за ${formatMonthLabel(year, month)} опубликовано в канал «${channel.title}» (топ-${items.length} из ${totalWithReactions}).`);
            log.info('bestof', 'published', { botId, channelId: String(channel.tg_chat_id), year, month, count: items.length });
        } catch (err) {
            log.error('bestof', 'publish_failed', { botId, err: err.message });
            await ctx.answerCbQuery('Ошибка: ' + (err.message || '').slice(0, 180));
        }
    });

    bot.action(/bestof:prev:(\d{4})-(\d{2})/, async (ctx) => {
        const year = parseInt(ctx.match[1], 10);
        const month = parseInt(ctx.match[2], 10);
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const channel = await resolveActiveChannel(botData, tgUserId);
        if (!channel) {
            await ctx.answerCbQuery('Нет подключённых каналов');
            return ctx.reply('Сначала подключите канал.');
        }

        try {
            const { items, totalWithReactions } = await composeBestOfMonth(supabase, botId, channel.tg_chat_id, year, month, {
                timezone: channel.timezone
            });
            if (items.length === 0) {
                await ctx.answerCbQuery('Нет данных за этот месяц');
                return ctx.reply(`За ${formatMonthLabel(year, month)} постов с реакциями в канале «${channel.title}» ещё нет.`);
            }

            await publishBestOf(bot, ctx.chat.id, items, { year, month, isPreview: true });
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.answerCbQuery('Предпросмотр готов');
            await ctx.reply(
                `👁 Предпросмотр показан выше. Источник: «${channel.title}» (топ-${items.length} из ${totalWithReactions}).`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback('📊 Опубликовать в канал', `bestof:pub:${year}-${String(month).padStart(2, '0')}`),
                        Markup.button.callback('🗑 Отмена', 'bestof:cancel')
                    ]
                ])
            );
            log.info('bestof', 'previewed', { botId, channelId: String(channel.tg_chat_id), year, month, count: items.length });
        } catch (err) {
            log.error('bestof', 'preview_failed', { botId, err: err.message });
            await ctx.answerCbQuery('Ошибка: ' + (err.message || '').slice(0, 180));
        }
    });

    bot.action('bestof:cancel', async (ctx) => {
        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.answerCbQuery('Отменено');
    });

    async function resolveActiveChannel(botData, tgUserId) {
        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);
        if (!channels || channels.length === 0) return null;

        const activeModes = botData?.active_modes || {};
        const activeId = activeModes[String(tgUserId)];
        const active = channels.find(c => String(c.tg_chat_id) === String(activeId));
        return active || channels[0];
    }
}
