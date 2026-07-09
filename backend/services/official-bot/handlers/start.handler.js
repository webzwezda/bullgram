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

                // Обработка ссылки-приглашения в админы бота: /start add_admin_<secret>
                if (startPayload.startsWith('add_admin_')) {
                    const inviteSecret = String(startPayload.replace(/^add_admin_/, '')).trim();
                    const tgUserId = Number(ctx.from?.id);
                    if (!inviteSecret || isNaN(tgUserId)) {
                        await ctx.reply('Приглашение недействительно.');
                        return sendMainMenu(ctx);
                    }

                    const { data: botAccount, error: botErr } = await service.supabase
                        .from('tg_accounts')
                        .select('id, admin_tg_ids, admin_invite_secret')
                        .eq('id', botId)
                        .maybeSingle();

                    const secretMatches = !botErr
                        && botAccount
                        && botAccount.admin_invite_secret
                        && String(botAccount.admin_invite_secret) === String(inviteSecret);

                    if (!secretMatches) {
                        await ctx.reply(
                            '❌ Приглашение недействительно или отозвано.\n\n' +
                            'Попросите у владельца бота новую ссылку-приглашение.',
                            { parse_mode: 'HTML' }
                        );
                        return sendMainMenu(ctx);
                    }

                    const currentAdmins = Array.isArray(botAccount.admin_tg_ids)
                        ? botAccount.admin_tg_ids.map(Number)
                        : [];

                    if (currentAdmins.includes(tgUserId)) {
                        await ctx.reply('✅ Вы уже являетесь администратором этого бота.', { parse_mode: 'HTML' });
                        return sendMainMenu(ctx);
                    }

                    currentAdmins.push(tgUserId);
                    const { error: updateErr } = await service.supabase
                        .from('tg_accounts')
                        .update({ admin_tg_ids: currentAdmins })
                        .eq('id', botId);

                    if (updateErr) {
                        console.error('Ошибка добавления admin по invite-ссылке:', updateErr.message);
                        await ctx.reply('Не удалось добавить вас в администраторы. Попробуйте позже.');
                        return sendMainMenu(ctx);
                    }

                    await ctx.reply(
                        '🎉 <b>Доступ администратора получен</b>\n\n' +
                        'Теперь вы можете управлять этим ботом — публиковать посты, модерировать предложения и смотреть статистику.',
                        { parse_mode: 'HTML' }
                    );
                    return sendMainMenu(ctx);
                }

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

                            let formattedWelcomeText = welcomeText;
                            if (!settings.referral_welcome_text) {
                                formattedWelcomeText = `🤝 <b>ПАРТНЕРСКОЕ ПРИГЛАШЕНИЕ</b>\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                    `Тебя пригласили по партнерской ссылке. Скидка <b>${discountPercent}%</b> уже закреплена за твоим профилем!\n\n` +
                                    `Выбирай тариф в меню и забирай доступ по лучшей цене.`;
                            } else {
                                formattedWelcomeText = `🤝 <b>ПАРТНЕРСКОЕ ПРИГЛАШЕНИЕ</b>\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                    `${welcomeText}`;
                            }
                            if (expiresAt) {
                                formattedWelcomeText += `\n\n⌛ <b>Скидка действует до:</b> <code>${expiresAt}</code>`;
                            }
                            await ctx.reply(formattedWelcomeText, { parse_mode: 'HTML' });
                        } else {
                            const msg = `🤝 <b>ПАРТНЕРСКОЕ ПРИГЛАШЕНИЕ</b>\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `Переход по партнерской ссылке зарегистрирован.\n\n` +
                                `⚠️ Скидки для новых клиентов сейчас на паузе. Если вы были закреплены за этим партнером ранее, ваши старые условия сохраняются.`;
                            await ctx.reply(msg, { parse_mode: 'HTML' });
                        }
                    } else {
                        const msg = `🤝 <b>ПАРТНЕРСКОЕ ПРИГЛАШЕНИЕ</b>\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `Переход зарегистрирован, однако партнерская программа сейчас отключена.\n\n` +
                            `Если вы уже были закреплены за этим партнером ранее, ваши условия будут сохранены.`;
                        await ctx.reply(msg, { parse_mode: 'HTML' });
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка в start handler:', error);
        }

        await sendMainMenu(ctx);
    });
}
