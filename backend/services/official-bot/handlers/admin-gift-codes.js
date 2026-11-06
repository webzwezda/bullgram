// Gift-code кластер админ-панели бота продаж: выбор тарифа для промокода
// (admin_gift_code) и выпуск кода (admin_gift_code_tariff_<id>). Вынесено
// дословно из admin.handler.js (behavior-preserving разрезка под pre-commit
// лимит 20000 байт); всё через переданный service (getUserRole, getBotOwner,
// createGiftAccessCode, supabase) — замыканий на модуль нет.
export function registerGiftCodeHandlers(bot, service, botId) {
    bot.action('admin_gift_code', async (ctx) => {
        await ctx.answerCbQuery();

        const userRole = await service.getUserRole(ctx, botId);
        if (userRole !== 'admin') {
            await ctx.reply('Эта кнопка доступна только админу проекта.');
            return;
        }

        const ownerId = await service.getBotOwner(botId);
        if (!ownerId) {
            await ctx.reply('Не удалось определить владельца бота.');
            return;
        }

        const { data: tariffs, error } = await service.supabase
            .from('tariffs')
            .select('id, title, channel_id, duration_days, is_active, channels(id, title)')
            .eq('owner_id', ownerId)
            .eq('is_active', true)
            .or(`bot_id.eq.${botId},bot_id.is.null`)
            .order('price', { ascending: true });

        if (error || !tariffs || !tariffs.length) {
            await ctx.reply('У этого бота нет активных тарифов для промокода.');
            return;
        }

        const rows = tariffs.map((tariff) => {
            const durationText = Number(tariff.duration_days) > 0 ? `${tariff.duration_days} дн.` : 'Навсегда';
            const channelTitle = tariff.channels?.title || 'Без канала';
            return [{ text: `${tariff.title} (${durationText}) — ${channelTitle}`, callback_data: `admin_gift_code_tariff_${tariff.id}` }];
        });

        const text = `🎁 <b>ВЫПУСК ПРОМОКОДА</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Выберите тариф для промокода. Получатель получит все каналы и ресурсы, входящие в этот тариф.`;

        const inlineKeyboard = [
            ...rows,
            [{ text: '🔙 Отмена', callback_data: 'admin_panel' }]
        ];

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(() => {});
        } else {
            await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        }
    });

    bot.action(/^admin_gift_code_tariff_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();

        const ownerId = await service.getBotOwner(botId);
        if (!ownerId) {
            await ctx.reply('Не удалось определить владельца бота.');
            return;
        }

        const tariffId = ctx.match[1];
        const { data: tariff, error } = await service.supabase
            .from('tariffs')
            .select('id, title, channel_id, duration_days')
            .eq('id', tariffId)
            .eq('owner_id', ownerId)
            .eq('is_active', true)
            .single();

        if (error || !tariff) {
            await ctx.reply('Тариф не найден или неактивен.');
            return;
        }

        try {
            const durationDays = Number(tariff.duration_days || 0);
            const giftCode = await service.createGiftAccessCode({
                ownerId,
                botId,
                channelId: tariff.channel_id,
                tariffId: tariff.id,
                durationDays,
                createdByTgUserId: ctx.from.id
            });

            const validUntil = giftCode.expires_at
                ? new Date(giftCode.expires_at).toLocaleDateString('ru-RU')
                : 'без срока';
            const durationText = durationDays > 0 ? `${durationDays} дней` : 'Навсегда';

            const text = `🎁 <b>ПРОМОКОД УСПЕШНО ВЫПУЩЕН</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `<b>Тариф:</b> ${tariff.title}\n` +
                `<b>Срок доступа:</b> <code>${durationText}</code>\n` +
                `<b>Промокод:</b> <code>${giftCode.code}</code>\n` +
                `<b>Действует до:</b> <code>${validUntil}</code>\n\n` +
                `<i>Получатель должен активировать этот код в боте с помощью кнопки «Мой статус & Промокоды» -> «Ввести код».</i>`;
            
            const keyboard = [[{ text: '🔙 К панели управления', callback_data: 'admin_panel' }]];

            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' }).catch(() => {});
            } else {
                await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' });
            }
        } catch (err) {
            console.error('Ошибка генерации gift code:', err);
            await ctx.reply('Не получилось выпустить промокод.');
        }
    });
}
