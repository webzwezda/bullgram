import {
    pendingGiftCodeInputs,
    pendingGiftCodeKey
} from '../shared/pending-state.js';

export function registerNavigationHandlers(bot, { service, botId, sendMainMenu, sendUserMainMenu, sendAdminMenu }) {
    bot.action('back_to_main', async (ctx) => { await ctx.answerCbQuery(); sendMainMenu(ctx); });

    bot.action('check_status', async (ctx) => {
        await ctx.answerCbQuery();
        try {
            const { data: subs, error } = await service.supabase.from('subscriptions').select('*').eq('tg_user_id', ctx.from.id).eq('status', 'active');
            if (error || !subs || subs.length === 0) return ctx.reply(' У вас пока нет активных подписок или их срок истек. Выберите тариф в меню!');

            let message = '✅ **Ваши активные подписки:**\n\n';
            for (const sub of subs) {
                let channelName = 'Закрытый канал';
                if (sub.channel_id) {
                    const { data: ch } = await service.supabase.from('channels').select('title').eq('id', sub.channel_id).single();
                    if (ch) channelName = ch.title;
                }
                let expDate = '♾ Навсегда';
                if (sub.expires_at) expDate = new Date(sub.expires_at).toLocaleDateString('ru-RU');
                message += `🔹 **${channelName}**\n⏳ Доступ до: ${expDate}\n\n`;
            }
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (err) { console.error('Ошибка статуса:', err); }
    });

    bot.action('my_status', async (ctx) => {
        await ctx.answerCbQuery();
        try {
            const adminContext = await service.getBotAdminContext(botId);
            const ownerId = adminContext?.ownerId;
            if (!ownerId) return;

            const { data: subs, error } = await service.supabase
                .from('subscriptions')
                .select('*, channels(title)')
                .eq('tg_user_id', ctx.from.id)
                .eq('status', 'active');

            if (error || !subs || subs.length === 0) {
                const msg = '📭 <b>Мой статус</b>\n\nУ вас пока нет активных подписок.\n\nВыберите тариф в главном меню, чтобы получить доступ к закрытым каналам и материалам.';
                return ctx.reply(msg, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🎁 Ввести код', callback_data: 'gift_code_redeem' }]] }
                });
            }

            let message = '📭 <b>Мой статус</b>\n\n✅ <b>Ваши активные подписки:</b>\n\n';
            for (const sub of subs) {
                const channelName = sub.channels?.title || 'Закрытый канал';
                let expDate = '♾️ Навсегда';
                if (sub.expires_at) {
                    const exp = new Date(sub.expires_at);
                    const now = new Date();
                    const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                    if (daysLeft <= 0) {
                        expDate = '⚠️ Истек';
                    } else if (daysLeft === 1) {
                        expDate = 'Завтра истекает';
                    } else if (daysLeft <= 7) {
                        expDate = `${daysLeft} дн.`;
                    } else {
                        expDate = exp.toLocaleDateString('ru-RU');
                    }
                }
                message += `🔹 ${channelName}\n   ⏳ До: ${expDate}\n\n`;
            }

            message += `${service.buildAdminOwnershipHint(adminContext, 'sales')}`;
            await ctx.reply(message, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '🎁 Ввести код', callback_data: 'gift_code_redeem' }]] }
            });
        } catch (err) {
            console.error('Ошибка my_status:', err);
            await ctx.reply('Не удалось загрузить статус.');
        }
    });

    bot.action('user_menu', async (ctx) => {
        await ctx.answerCbQuery();
        pendingGiftCodeInputs.delete(pendingGiftCodeKey(botId, ctx.from.id));
        await sendUserMainMenu(ctx);
    });

    bot.action('admin_panel', async (ctx) => {
        await ctx.answerCbQuery();
        pendingGiftCodeInputs.delete(pendingGiftCodeKey(botId, ctx.from.id));
        await sendAdminMenu(ctx);
    });

    bot.action('gift_code_redeem', async (ctx) => {
        await ctx.answerCbQuery();
        pendingGiftCodeInputs.set(pendingGiftCodeKey(botId, ctx.from.id), {
            mode: 'redeem',
            requestedAt: Date.now()
        });
        await ctx.reply('Пришли подарочный код одним сообщением. Например: ABCD-EFGH-JKLM');
    });
}
