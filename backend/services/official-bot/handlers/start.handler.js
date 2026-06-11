import { loadReferralReserveState } from '../../referral-reserve.service.js';

export function registerStartHandlers(bot, { service, botId, sendMainMenu, createInvoiceForTariff }) {
    bot.start(async (ctx) => {
        try {
            const ownerId = await service.getBotOwner(botId);
            if (ownerId) {
                const startText = ctx.message?.text || '';
                const startPayload = startText.startsWith('/start ') ? startText.slice(7).trim() : '';
                const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;

                await service.logCustomerFunnelEvent({
                    ownerId,
                    botId,
                    tgUserId: ctx.from.id,
                    eventType: 'bot_started',
                    source: 'official_bot',
                    sessionKey: [botId || 'bot', ctx.from.id, 'bot_started', 'first_touch'].join(':'),
                    payload: {
                        username: ctx.from?.username || null,
                        display_name: displayName,
                        first_name: ctx.from?.first_name || null,
                        last_name: ctx.from?.last_name || null,
                        start_payload: startPayload || null
                    }
                });

                // Обработка прямой ссылки на покупку тарифа/товара
                if (startPayload.startsWith('buy_')) {
                    const tariffId = startPayload.replace(/^buy_tariff_/, '').replace(/^buy_/, '');
                    const { data: tariff, error } = await service.supabase
                        .from('tariffs')
                        .select('*')
                        .eq('id', tariffId)
                        .maybeSingle();

                    if (!error && tariff && tariff.is_active) {
                        const referralAttribution = await service.getActiveReferralAttribution(ownerId, ctx.from.id);
                        const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);

                        const { data: siblingTariffs } = await service.supabase.from('tariffs')
                            .select('*')
                            .eq('owner_id', tariff.owner_id)
                            .eq('is_active', true);

                        const paymentGroup = service.findTariffPaymentGroup(siblingTariffs || [tariff], tariff);

                        if (paymentGroup.variants.length > 1) {
                            await service.logCustomerFunnelEvent({
                                ownerId,
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
                                    start_payload: startPayload,
                                    source: 'deep_link_group',
                                    variants_count: paymentGroup.variants.length
                                }
                            });

                            const keyboard = service.sortTariffPaymentVariants(paymentGroup.variants)
                                .map((variant) => ([{
                                    text: `${service.getTariffCurrencyIcon(variant.currency)} ${service.formatTariffPaymentOptions([variant], referralDiscountPercent)}`,
                                    callback_data: `pay_tariff_${variant.id}`
                                }]));
                            keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

                            await ctx.reply(
                                `Выберите способ оплаты для «${service.getTariffDisplayTitle(paymentGroup.lead)}»:`,
                                { reply_markup: { inline_keyboard: keyboard } }
                            );
                            return;
                        }

                        // Если вариант только один, сразу выставляем инвойс
                        await service.logCustomerFunnelEvent({
                            ownerId,
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
                                start_payload: startPayload,
                                source: 'deep_link_single',
                                currency: tariff.currency
                            }
                        });

                        return createInvoiceForTariff(ctx, tariff);
                    } else {
                        await ctx.reply('❌ Этот тариф или цифровой товар сейчас недоступен.');
                        return sendMainMenu(ctx);
                    }
                }

                if (startPayload.startsWith('ref_')) {
                    const settings = await service.getReferralSettings(ownerId);
                    const reserve = await loadReferralReserveState(service.supabase, ownerId, { ensure: true });

                    if (settings.referral_enabled) {
                        const attribution = await service.registerReferralLead({
                            ownerId,
                            referralCode: startPayload.replace(/^ref_/, ''),
                            referredTgUserId: ctx.from.id,
                            referredUsername: ctx.from?.username || null,
                            referredDisplayName: displayName,
                            rewardPercent: settings.referral_reward_percent,
                            clientDiscountPercent: settings.referral_client_discount_percent,
                            discountEligible: reserve.canAcceptNewPartners,
                            reserveStatus: reserve.status
                        });

                        const discountEligible = attribution?.discount_eligible !== false
                            && (!attribution?.expires_at || new Date(attribution.expires_at) >= new Date());
                        if (discountEligible) {
                            const discountPercent = Number(attribution?.client_discount_percent_snapshot || settings.referral_client_discount_percent || 0);
                            const expiresAt = attribution?.expires_at
                                ? new Date(attribution.expires_at).toLocaleDateString('ru-RU')
                                : '';
                            const welcomeText = settings.referral_welcome_text
                                || `Тебя привели по партнерской ссылке. Скидка ${discountPercent}% уже закреплена, выбирай тариф.`;
                            await ctx.reply(`🤝 ${welcomeText}${expiresAt ? `\n\nСкидка действует до ${expiresAt}.` : ''}`);
                        } else {
                            await ctx.reply('🤝 Переход по партнерской ссылке записан, но скидка для новых клиентов сейчас на паузе. Если ты был закреплен раньше, старые условия сохранятся.');
                        }
                    } else {
                        await ctx.reply('🤝 Партнерская программа сейчас выключена. Если ты уже был закреплен раньше, старые условия сохранятся.');
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка в start handler:', error);
        }

        await sendMainMenu(ctx);
    });
}
