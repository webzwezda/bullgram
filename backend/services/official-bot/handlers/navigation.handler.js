import {
    pendingGiftCodeInputs,
    pendingGiftCodeKey
} from '../shared/pending-state.js';

export async function renderMyStatus(ctx, { service, botId }) {
    try {
        const adminContext = await service.getBotAdminContext(botId);
        const ownerId = adminContext?.ownerId;
        if (!ownerId) return;

        const { data: subs, error } = await service.supabase
            .from('subscriptions')
            .select('*, channels(title)')
            .eq('tg_user_id', ctx.from.id)
            .eq('status', 'active');

        const inlineKeyboard = [
            [{ text: '🎁 Ввести промокод', callback_data: 'gift_code_redeem' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
        ];

        if (error || !subs || subs.length === 0) {
            const msg = `📭 <b>МОЙ СТАТУС & ПРОМОКОДЫ</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `У вас пока нет активных подписок.\n\n` +
                `Выберите тариф в главном меню, чтобы получить доступ к закрытым каналам и материалам.`;
            
            if (ctx.callbackQuery) {
                await ctx.editMessageText(msg, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: inlineKeyboard }
                }).catch(async () => {
                    await ctx.reply(msg, {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                });
            } else {
                await ctx.reply(msg, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: inlineKeyboard }
                });
            }
            return;
        }

        let message = `📭 <b>МОЙ СТАТУС & ПРОМОКОДЫ</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✅ <b>Ваши активные подписки:</b>\n\n`;
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
            message += `🔹 <b>${channelName}</b>\n   ⏳ До: <code>${expDate}</code>\n\n`;
        }

        message += `${service.buildAdminOwnershipHint(adminContext, 'sales')}`;

        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: inlineKeyboard }
            }).catch(async () => {
                await ctx.reply(message, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: inlineKeyboard }
                });
            });
        } else {
            await ctx.reply(message, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
        }
    } catch (err) {
        console.error('Ошибка my_status:', err);
        await ctx.reply('Не удалось загрузить статус.');
    }
}

export function registerNavigationHandlers(bot, { service, botId, sendMainMenu, sendUserMainMenu, sendAdminMenu }) {
    bot.action('back_to_main', async (ctx) => { await ctx.answerCbQuery(); sendMainMenu(ctx); });

    bot.action('check_status', async (ctx) => {
        await ctx.answerCbQuery();
        try {
            const { data: subs, error } = await service.supabase.from('subscriptions').select('*').eq('tg_user_id', ctx.from.id).eq('status', 'active');
            
            const inlineKeyboard = [[{ text: '🔙 Назад', callback_data: 'back_to_main' }]];
            
            if (error || !subs || subs.length === 0) {
                const msg = `📭 <b>АКТИВНЫЕ ПОДПИСКИ</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `У вас пока нет активных подписок или их срок истек. Выберите тариф в меню!`;
                if (ctx.callbackQuery) {
                    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
                } else {
                    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
                }
                return;
            }

            let message = `📭 <b>АКТИВНЫЕ ПОДПИСКИ</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const sub of subs) {
                let channelName = 'Закрытый канал';
                if (sub.channel_id) {
                    const { data: ch } = await service.supabase.from('channels').select('title').eq('id', sub.channel_id).single();
                    if (ch) channelName = ch.title;
                }
                let expDate = '♾ Навсегда';
                if (sub.expires_at) expDate = new Date(sub.expires_at).toLocaleDateString('ru-RU');
                message += `🔹 <b>${channelName}</b>\n⏳ Доступ до: <code>${expDate}</code>\n\n`;
            }
            
            if (ctx.callbackQuery) {
                await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
            } else {
                await ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
            }
        } catch (err) { console.error('Ошибка статуса:', err); }
    });

    bot.action('my_status', async (ctx) => {
        await ctx.answerCbQuery();
        await renderMyStatus(ctx, { service, botId });
    });

    bot.hears('👤 Мой статус', async (ctx) => {
        await renderMyStatus(ctx, { service, botId });
    });

    bot.hears('🛠 Админка', async (ctx) => {
        const userRole = await service.getUserRole(ctx, botId);
        if (userRole === 'admin') {
            pendingGiftCodeInputs.delete(pendingGiftCodeKey(botId, ctx.from.id));
            await sendAdminMenu(ctx);
        } else {
            await ctx.reply('❌ У вас нет прав администратора.');
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
        
        const text = `🎁 <b>АКТИВАЦИЯ ПРОМОКОДА</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Пожалуйста, отправьте подарочный код ответным сообщением.\n\n` +
            `<b>Формат кода:</b> <code>XXXX-XXXX-XXXX</code>`;
        
        const keyboard = [[{ text: '🔙 Отмена', callback_data: 'my_status' }]];
        
        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
        } else {
            await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
    });
}
