export function registerTariffExactHandlers(bot, { service, botId, createInvoiceForTariff }) {
    bot.action('buy_tariff', async (ctx) => {
        await ctx.answerCbQuery();
        try {
            const adminContext = await service.getBotAdminContext(botId);
            const ownerId = adminContext?.ownerId;
            if (!ownerId) return;

            const { data: tariffs, error } = await service.supabase.from('tariffs')
                .select('*').eq('owner_id', ownerId).eq('is_active', true).order('price', { ascending: true });

            if (error || !tariffs || tariffs.length === 0) {
                const msg = '😔 К сожалению, сейчас нет доступных тарифов.';
                return ctx.reply(msg);
            }

            const tariffGroups = service.buildTariffPaymentGroups(tariffs);
            const tariffsWithBundles = await Promise.all(tariffGroups.map(async group => ({
                group,
                tariff: group.lead,
                bundleItems: await service.getTariffBundleItems(group.lead, ownerId)
            })));
            const referralAttribution = await service.getActiveReferralAttribution(ownerId, ctx.from.id);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);

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
                    callback: 'buy_tariff',
                    tariffs_count: tariffGroups.length
                }
            });

            const inlineKeyboard = tariffsWithBundles.flatMap(({ group, tariff, bundleItems }) => {
                const icon = service.getTariffGroupIcon(group);
                const paymentOptions = service.formatTariffPaymentOptions(group.variants, referralDiscountPercent);
                return [
                    [{ text: `${icon} ${service.getTariffDisplayTitle(tariff)} — ${paymentOptions}`, callback_data: `buy_${tariff.id}` }],
                    [{ text: `📦 ${service.formatTariffBundleSummary(tariff, bundleItems)}`, callback_data: `show_tariff_${tariff.id}` }]
                ];
            });
            inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

            const discountLine = referralDiscountPercent > 0
                ? `\n\n🤝 Твоя партнерская скидка: <b>-${referralDiscountPercent}%</b>. В счете уже будет цена со скидкой.`
                : '';
            const text = `💳 <b>Выберите тариф</b>${discountLine}\n\n${service.buildAdminOwnershipHint(adminContext, 'sales')}`;
            await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        } catch (error) {
            console.error('Ошибка покупки тарифа:', error);
        }
    });
}

export function registerTariffRegexHandlers(bot, { service, botId, createInvoiceForTariff }) {
    bot.action(/^show_tariff_(.+)$/, async (ctx) => {
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
                eventType: 'tariff_card_opened',
                referralCode: referralAttribution?.referral_code || null,
                sessionKey: service.buildCustomerFunnelSessionKey({
                    botId,
                    tgUserId: ctx.from.id,
                    eventType: 'tariff_card_opened',
                    tariffId: tariff.id
                }),
                payload: {
                    callback: 'show_tariff',
                    tariff_title: tariff.title,
                    currency: tariff.currency,
                    price: tariff.price
                }
            });
            const { data: siblingTariffs } = await service.supabase.from('tariffs')
                .select('*')
                .eq('owner_id', tariff.owner_id)
                .eq('is_active', true);
            const paymentGroup = service.findTariffPaymentGroup(siblingTariffs || [tariff], tariff);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
            const paymentLines = service.sortTariffPaymentVariants(paymentGroup.variants)
                .map((variant) => {
                    const currency = variant.currency || 'TON';
                    const price = Number(variant.price || 0);
                    const discountedPrice = service.formatDiscountedAmount(price, currency, referralDiscountPercent);
                    const priceText = referralDiscountPercent > 0 && discountedPrice < price
                        ? `${discountedPrice} ${currency} вместо ${price} ${currency}`
                        : `${price} ${currency}`;
                    return `• **${priceText}**`;
                })
                .join('\n');

            const bundleItems = await service.getTariffBundleItems(tariff, tariff.owner_id);
            const channelItems = bundleItems.filter(item => item.item_type === 'channel' && item.channels);
            const resourceItems = bundleItems.filter(item => item.item_type === 'resource');
            const durationText = Number(tariff.duration_days) > 0 ? `${tariff.duration_days} дней` : 'Навсегда';
            let primaryChannel = null;
            if (tariff.channel_id) {
                const { data } = await service.supabase.from('channels').select('id, title, tg_chat_id').eq('id', tariff.channel_id).single();
                primaryChannel = data || null;
            }
            const lines = [];
            for (const ci of channelItems) {
                lines.push(`• ${ci.channels.title}`);
            }
            for (const ri of resourceItems) {
                lines.push(`• ${ri.resource_title}: ${ri.resource_url}`);
            }
            if (primaryChannel && !channelItems.some(ci => ci.channels?.id === primaryChannel.id)) {
                lines.unshift(`• ${primaryChannel.title}`);
            }
            const discountNote = referralDiscountPercent > 0
                ? `\nСкидка по рефке: **-${referralDiscountPercent}%**`
                : '';

            await ctx.reply(
                `📦 **${service.getTariffDisplayTitle(tariff)}**\n\nЦена:\n${paymentLines}\nСрок: **${durationText}**${discountNote}\n\n${lines.join('\n')}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Ошибка показа тарифа:', error);
            await ctx.reply('❌ Не получилось показать состав тарифа');
        }
    });

    bot.action(/^buy_(?!tariff$)(.+)$/, async (ctx) => {
        const tariffId = ctx.match[1];
        await ctx.answerCbQuery();

        try {
            const { data: tariff } = await service.supabase.from('tariffs').select('*').eq('id', tariffId).single();
            if (!tariff) return ctx.reply('❌ Тариф не найден.');
            const { data: siblingTariffs } = await service.supabase.from('tariffs')
                .select('*')
                .eq('owner_id', tariff.owner_id)
                .eq('is_active', true);
            const paymentGroup = service.findTariffPaymentGroup(siblingTariffs || [tariff], tariff);
            const referralAttribution = await service.getActiveReferralAttribution(tariff.owner_id, ctx.from.id);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);

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
                        text: `${service.getTariffCurrencyIcon(variant.currency)} ${service.formatTariffPaymentOptions([variant], referralDiscountPercent)}`,
                        callback_data: `pay_tariff_${variant.id}`
                    }]));
                keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

                await ctx.deleteMessage().catch(() => {});
                await ctx.reply(
                    `Выберите способ оплаты для «${service.getTariffDisplayTitle(paymentGroup.lead)}»:`,
                    { reply_markup: { inline_keyboard: keyboard } }
                );
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
                .select('*').eq('owner_id', ownerId).eq('is_active', true).order('price', { ascending: true });

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
                .select('*').eq('owner_id', ownerId).eq('is_active', true).order('price', { ascending: true });

            if (error || !tariffs) return;

            const tariffGroups = service.buildTariffPaymentGroups(tariffs);
            const categoryTariffs = tariffGroups.filter(group => service.getTariffCategory(group.lead) === category);

            if (categoryTariffs.length === 0) {
                return ctx.reply('В этой категории пока нет тарифов.');
            }

            const tariffsWithBundles = await Promise.all(categoryTariffs.map(async group => ({
                group,
                tariff: group.lead,
                bundleItems: await service.getTariffBundleItems(group.lead, ownerId)
            })));

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

            const inlineKeyboard = tariffsWithBundles.flatMap(({ group, tariff, bundleItems }) => {
                const icon = service.getTariffGroupIcon(group);
                const paymentOptions = service.formatTariffPaymentOptions(group.variants);
                return [
                    [{ text: `${icon} ${service.getTariffDisplayTitle(tariff)} — ${paymentOptions}`, callback_data: `buy_${tariff.id}` }],
                    [{ text: `📦 ${service.formatTariffBundleSummary(tariff, bundleItems)}`, callback_data: `show_tariff_${tariff.id}` }]
                ];
            });
            inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

            const categoryLabels = {
                trial: '🧪 Пробные',
                regular: '📦 Обычные',
                bundle: '🎁 Комплекты',
                premium: '💎 Премиум',
                lifetime: '♾️ Навсегда'
            };
            const label = categoryLabels[category] || '📦 Тарифы';

            const text = `${label}\n\n${service.buildAdminOwnershipHint(adminContext, 'sales')}`;
            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard } });
            } else {
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard } });
            }
        } catch (error) {
            console.error('Ошибка категории:', error);
        }
    });
}
