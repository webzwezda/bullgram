export async function renderTariffSelection(ctx, { service, botId }) {
    try {
        const adminContext = await service.getBotAdminContext(botId);
        const ownerId = adminContext?.ownerId;
        if (!ownerId) return;

        const { data: tariffs, error } = await service.supabase.from('tariffs')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('is_active', true)
            .or(`bot_id.eq.${botId},bot_id.is.null`)
            .order('price', { ascending: true });

        if (error || !tariffs || tariffs.length === 0) {
            const msg = '😔 К сожалению, сейчас нет доступных тарифов.';
            return ctx.reply(msg);
        }

        const tariffGroups = service.buildTariffPaymentGroups(tariffs);
        const referralAttribution = await service.getActiveReferralAttribution(ownerId, ctx.from.id);
        const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
        const browseDiscountPercent = await service.getBrowseFollowupDiscount(ownerId, ctx.from.id);
        const activeDiscountPercent = Math.max(referralDiscountPercent, browseDiscountPercent);

        await service.logCustomerFunnelEvent({
            ownerId,
            botId,
            tgUserId: ctx.from.id,
            eventType: 'tariff_list_opened',
            referralCode: referralAttribution?.referral_code || null,
            sessionKey: service.buildCustomerFunnelSessionKey({
                botId,
                tgUserId: ctx.from.id,
                eventType: 'tariff_list_opened'
            }),
            payload: {
                callback: ctx.callbackQuery ? 'buy_tariff' : 'reply_keyboard',
                tariffs_count: tariffGroups.length
            }
        });

        const inlineKeyboard = tariffGroups.map((group) => {
            const tariff = group.lead;
            const icon = service.getTariffGroupIcon(group);
            const paymentOptions = service.formatTariffPaymentOptions(group.variants, activeDiscountPercent);
            return [
                { text: `${icon} ${service.getTariffDisplayTitle(tariff)} — ${paymentOptions}`, callback_data: `buy_${tariff.id}` }
            ];
        });
        inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

        const discountLine = activeDiscountPercent > 0
            ? `\n\n🎁 Доступна скидка: <b>-${activeDiscountPercent}%</b>. В счете уже будет цена со скидкой.`
            : '';
        
        const text = `💳 <b>ВЫБОР ТАРИФА</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Выберите подходящий вариант подписки или цифрового товара ниже.${discountLine}\n\n` +
            `${service.buildAdminOwnershipHint(adminContext, 'sales')}`;

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(async () => {
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            });
        } else {
            await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        }
    } catch (error) {
        console.error('Ошибка покупки тарифа:', error);
    }
}

export function registerTariffExactHandlers(bot, { service, botId, createInvoiceForTariff }) {
    bot.action('buy_tariff', async (ctx) => {
        await ctx.answerCbQuery();
        await renderTariffSelection(ctx, { service, botId });
    });

    bot.hears('💳 Купить подписку', async (ctx) => {
        await renderTariffSelection(ctx, { service, botId });
    });
}

export function registerTariffRegexHandlers(bot, { service, botId, createInvoiceForTariff }) {
    bot.action(/^buy_(?!tariff$)(.+)$/, async (ctx) => {
        const tariffId = ctx.match[1];
        await ctx.answerCbQuery();

        try {
            const { data: tariff } = await service.supabase.from('tariffs').select('*').eq('id', tariffId).single();
            if (!tariff) return ctx.reply('❌ Тариф не найден.');
            const { data: siblingTariffs } = await service.supabase.from('tariffs')
                .select('*')
                .eq('owner_id', tariff.owner_id)
                .eq('is_active', true)
                .or(`bot_id.eq.${botId},bot_id.is.null`);
            const paymentGroup = service.findTariffPaymentGroup(siblingTariffs || [tariff], tariff);
            const referralAttribution = await service.getActiveReferralAttribution(tariff.owner_id, ctx.from.id);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
            const browseDiscountPercent = await service.getBrowseFollowupDiscount(tariff.owner_id, ctx.from.id);
            const activeDiscountPercent = Math.max(referralDiscountPercent, browseDiscountPercent);

            if (paymentGroup.variants.length > 1) {
                await service.logCustomerFunnelEvent({
                    ownerId: tariff.owner_id,
                    botId,
                    tgUserId: ctx.from.id,
                    tariffId: tariff.id,
                    eventType: 'tariff_card_opened',
                    referralCode: referralAttribution?.referral_code || null,
                    sessionKey: service.buildCustomerFunnelSessionKey({
                        botId,
                        tgUserId: ctx.from.id,
                        eventType: 'tariff_card_opened',
                        tariffId: tariff.id
                    }),
                    payload: {
                        callback: 'buy',
                        tariff_title: tariff.title,
                        variants_count: paymentGroup.variants.length
                    }
                });
                const keyboard = service.sortTariffPaymentVariants(paymentGroup.variants)
                    .map((variant) => ([{
                        text: `${service.getTariffCurrencyIcon(variant.currency)} ${service.formatTariffPaymentOptions([variant], activeDiscountPercent)}`,
                        callback_data: `pay_tariff_${variant.id}`
                    }]));
                keyboard.push([{ text: '🔙 Назад', callback_data: 'buy_tariff' }]);

                await ctx.deleteMessage().catch(() => {});
                
                const durationText = Number(tariff.duration_days) > 0 ? `${tariff.duration_days} дней` : 'Навсегда';

                const text = `💳 <b>СПОСОБ ОПЛАТЫ</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📦 Тариф: <b>${service.getTariffDisplayTitle(paymentGroup.lead)}</b>\n` +
                    `⏳ Срок доступа: <code>${durationText}</code>\n\n` +
                    `Выберите удобный способ оплаты ниже:`;
                
                await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' });
                return;
            }

            await service.logCustomerFunnelEvent({
                ownerId: tariff.owner_id,
                botId,
                tgUserId: ctx.from.id,
                tariffId: tariff.id,
                eventType: 'payment_method_selected',
                referralCode: referralAttribution?.referral_code || null,
                sessionKey: service.buildCustomerFunnelSessionKey({
                    botId,
                    tgUserId: ctx.from.id,
                    eventType: 'payment_method_selected',
                    tariffId: tariff.id
                }),
                payload: {
                    callback: 'buy',
                    currency: tariff.currency,
                    tariff_title: tariff.title
                }
            });
            await createInvoiceForTariff(ctx, tariff);
        } catch (err) { console.error('Ошибка выбора способа оплаты:', err); }
    });

    bot.action(/^pay_tariff_(.+)$/, async (ctx) => {
        const tariffId = ctx.match[1];
        await ctx.answerCbQuery();

        try {
            const { data: tariff } = await service.supabase.from('tariffs').select('*').eq('id', tariffId).single();
            if (!tariff) return ctx.reply('❌ Тариф не найден.');
            const referralAttribution = await service.getActiveReferralAttribution(tariff.owner_id, ctx.from.id);
            await service.logCustomerFunnelEvent({
                ownerId: tariff.owner_id,
                botId,
                tgUserId: ctx.from.id,
                tariffId: tariff.id,
                eventType: 'payment_method_selected',
                referralCode: referralAttribution?.referral_code || null,
                sessionKey: service.buildCustomerFunnelSessionKey({
                    botId,
                    tgUserId: ctx.from.id,
                    eventType: 'payment_method_selected',
                    tariffId: tariff.id
                }),
                payload: {
                    callback: 'pay_tariff',
                    currency: tariff.currency,
                    tariff_title: tariff.title
                }
            });
            await createInvoiceForTariff(ctx, tariff);
        } catch (err) { console.error('Ошибка выбранного способа оплаты:', err); }
    });

    bot.action(/^tariffs_page_(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1], 10);
        try {
            const adminContext = await service.getBotAdminContext(botId);
            const ownerId = adminContext?.ownerId;
            if (!ownerId) return;

            const { data: tariffs, error } = await service.supabase.from('tariffs')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('is_active', true)
                .or(`bot_id.eq.${botId},bot_id.is.null`)
                .order('price', { ascending: true });

            if (error || !tariffs) return;

            const tariffGroups = service.buildTariffPaymentGroups(tariffs);
            await service.logCustomerFunnelEvent({
                ownerId,
                botId,
                tgUserId: ctx.from.id,
                eventType: 'tariff_list_opened',
                sessionKey: service.buildCustomerFunnelSessionKey({
                    botId,
                    tgUserId: ctx.from.id,
                    eventType: 'tariff_list_opened'
                }),
                payload: {
                    callback: 'tariffs_page',
                    page,
                    tariffs_count: tariffGroups.length
                }
            });
        } catch (error) {
            console.error('Ошибка пагинации:', error);
        }
    });

    bot.action(/^category_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const category = ctx.match[1];
        try {
            const adminContext = await service.getBotAdminContext(botId);
            const ownerId = adminContext?.ownerId;
            if (!ownerId) return;

            const { data: tariffs, error } = await service.supabase.from('tariffs')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('is_active', true)
                .or(`bot_id.eq.${botId},bot_id.is.null`)
                .order('price', { ascending: true });

            if (error || !tariffs) return;

            const tariffGroups = service.buildTariffPaymentGroups(tariffs);
            const categoryTariffs = tariffGroups.filter(group => service.getTariffCategory(group.lead) === category);

            if (categoryTariffs.length === 0) {
                return ctx.reply('В этой категории пока нет тарифов.');
            }

            const referralAttribution = await service.getActiveReferralAttribution(ownerId, ctx.from.id);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
            const browseDiscountPercent = await service.getBrowseFollowupDiscount(ownerId, ctx.from.id);
            const activeDiscountPercent = Math.max(referralDiscountPercent, browseDiscountPercent);

            await service.logCustomerFunnelEvent({
                ownerId,
                botId,
                tgUserId: ctx.from.id,
                eventType: 'tariff_list_opened',
                sessionKey: service.buildCustomerFunnelSessionKey({
                    botId,
                    tgUserId: ctx.from.id,
                    eventType: 'tariff_list_opened'
                }),
                payload: {
                    callback: 'category',
                    category,
                    tariffs_count: categoryTariffs.length
                }
            });

            const inlineKeyboard = categoryTariffs.map((group) => {
                const tariff = group.lead;
                const icon = service.getTariffGroupIcon(group);
                const paymentOptions = service.formatTariffPaymentOptions(group.variants, activeDiscountPercent);
                return [
                    { text: `${icon} ${service.getTariffDisplayTitle(tariff)} — ${paymentOptions}`, callback_data: `buy_${tariff.id}` }
                ];
            });
            inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'buy_tariff' }]);

            const categoryLabels = {
                trial: '🧪 Пробные',
                regular: '📦 Обычные',
                bundle: '🎁 Комплекты',
                premium: '💎 Премиум',
                lifetime: '♾️ Навсегда'
            };
            const label = categoryLabels[category] || '📦 Тарифы';

            const text = `📁 <b>КАТЕГОРИЯ: ${label.toUpperCase()}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Выберите подходящий вариант подписки ниже:\n\n` +
                `${service.buildAdminOwnershipHint(adminContext, 'sales')}`;

            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            } else {
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            }
        } catch (error) {
            console.error('Ошибка категории:', error);
        }
    });
}
