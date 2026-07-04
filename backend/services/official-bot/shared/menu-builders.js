export function createMenuBuilders({ service, botId }) {
    const sendAdminMenu = async (ctx) => {
        const adminContext = await service.getBotAdminContext(botId);
        const inlineKeyboard = [
            [{ text: '🔎 Проверка чеков', callback_data: 'admin_verify_receipts' }],
            [{ text: '🎁 Выпустить промокод', callback_data: 'admin_gift_code' }],
            [
                { text: '📊 Статистика', callback_data: 'admin_stats' },
                { text: '💸 Партнерка', callback_data: 'admin_referral' }
            ],
            [
                { text: '👤 Мой профиль', callback_data: 'admin_profile' },
                { text: '⚙️ Тарифы', callback_data: 'admin_tariffs' }
            ],
            [{ text: '🔙 Режим пользователя', callback_data: 'user_menu' }]
        ];

        const text = `🛠 <b>ПАНЕЛЬ УПРАВЛЕНИЯ</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Вы находитесь в режиме администратора.\n\n` +
            `${service.buildAdminOwnershipHint(adminContext, 'sales')}\n\n` +
            `Выберите действие на панели управления:`;

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        } else {
            await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        }
    };

    const sendUserMainMenu = async (ctx) => {
        try {
            const adminContext = await service.getBotAdminContext(botId);
            const ownerId = adminContext?.ownerId;
            if (!ownerId) return;

            const userRole = await service.getUserRole(ctx, botId);
            const isAdmin = userRole === 'admin';

            const inlineKeyboard = [];

            if (isAdmin) {
                inlineKeyboard.push([{ text: '🛠 Админ-панель', callback_data: 'admin_panel' }]);
            }

            inlineKeyboard.push([{ text: '💳 Оформить подписку / Купить', callback_data: 'buy_tariff' }]);

            const existingReferralProfile = adminContext.referralEnabled
                ? null
                : await service.getReferralProfile(ownerId, ctx.from.id).catch(() => null);

            if (adminContext.referralEnabled || existingReferralProfile) {
                inlineKeyboard.push([{ text: '🤝 Партнерская программа', callback_data: 'referral_info' }]);
            }

            inlineKeyboard.push([{ text: '👤 Мой статус & Промокоды', callback_data: 'my_status' }]);

            const replyKeyboard = [
                [{ text: '💳 Купить подписку' }, { text: '👤 Мой статус' }],
                [{ text: '🤝 Партнерка' }]
            ];
            if (isAdmin) {
                replyKeyboard[1].push({ text: '🛠 Админка' });
            }

            const firstName = ctx.from?.first_name || '';
            const userGreeting = firstName ? `, <b>${firstName}</b>` : '';
            const welcomeText = `👋 Приветствуем${userGreeting} в нашем боте!\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Здесь вы можете мгновенно получить доступ в приватные группы/каналы или приобрести цифровые товары.\n\n` +
                `👇 Выберите необходимое действие ниже:`;

            if (ctx.callbackQuery) {
                await ctx.editMessageText(welcomeText, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            } else {
                await ctx.reply(welcomeText, {
                    reply_markup: {
                        keyboard: replyKeyboard,
                        resize_keyboard: true,
                        is_persistent: true
                    },
                    parse_mode: 'HTML'
                });
            }
        } catch (error) {
            console.error('Ошибка меню:', error);
            console.error('Error details:', error.message);
            console.error('Stack:', error.stack);
        }
    };

    const sendMainMenu = async (ctx) => {
        if (service._normalizedRole === 'ops') {
            const adminContext = await service.getBotAdminContext(botId);
            const text = `🧭 <b>Бот-админ юзерботов</b>\n\nСюда прилетают сигналы о новых личках и мутных входящих от юзерботов.\n\nЕсли тут тишина, значит никто ничего не написал или сигналов пока нет.\n\n${service.buildAdminOwnershipHint(adminContext, 'ops')}\n\nОткрывай веб-панель и смотри <b>Центр юзербота</b>, когда надо быстро ответить человеку.`;
            return ctx.reply(text, { parse_mode: 'HTML' });
        }

        return sendUserMainMenu(ctx);
    };

    const createInvoiceForTariff = async (ctx, tariff) => {
        try {
            const durationText = Number(tariff.duration_days) > 0 ? `${tariff.duration_days} дней` : 'Навсегда';

            const { data: settings } = await service.supabase.from('payment_settings').select('*').eq('owner_id', tariff.owner_id).single();
            if (!settings) return ctx.reply('❌ Администратор не настроил реквизиты.');

            const userId = ctx.from.id;
            const memo = 'sub_' + Math.random().toString(36).substr(2, 6);
            const referralAttribution = await service.getActiveReferralAttribution(tariff.owner_id, userId);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
            const browseDiscountPercent = await service.getBrowseFollowupDiscount(tariff.owner_id, userId);
            const activeDiscountPercent = Math.max(referralDiscountPercent, browseDiscountPercent);
            const originalAmount = Number(tariff.price || 0);
            const invoiceAmount = service.formatDiscountedAmount(originalAmount, tariff.currency, activeDiscountPercent);
            const referralDiscountAmount = Number((originalAmount - invoiceAmount).toFixed(tariff.currency === 'RUB' ? 2 : 4));

            const { error: insertErr } = await service.supabase.from('invoices').insert({
                tg_user_id: userId, tariff_id: tariff.id, amount: invoiceAmount, currency: tariff.currency, memo: memo, status: 'pending'
            });

            if (insertErr) return ctx.reply(`❌ Ошибка БД при создании счета:\n${insertErr.message}`);

            const { data: createdInvoice } = await service.supabase
                .from('invoices')
                .select('id')
                .eq('memo', memo)
                .single();

            await service.logCustomerFunnelEvent({
                ownerId: tariff.owner_id,
                botId,
                tgUserId: userId,
                tariffId: tariff.id,
                eventType: 'invoice_created',
                referralCode: referralAttribution?.referral_code || null,
                sessionKey: service.buildCustomerFunnelSessionKey({
                    botId,
                    tgUserId: userId,
                    eventType: 'invoice_created',
                    tariffId: tariff.id
                }),
                payload: {
                    invoice_id: createdInvoice?.id || null,
                    amount: invoiceAmount,
                    currency: tariff.currency,
                    original_amount: originalAmount,
                    referral_discount_percent: activeDiscountPercent
                }
            });

            await service.logPaymentEvent({
                ownerId: tariff.owner_id,
                invoiceId: createdInvoice?.id,
                provider: tariff.currency === 'RUB' ? 'manual_rub' : 'manual_ton',
                eventType: 'invoice_created',
                status: 'pending',
                payload: {
                    tariff_id: tariff.id,
                    amount: invoiceAmount,
                    currency: tariff.currency,
                    memo,
                    referral_discount_percent: activeDiscountPercent,
                    referral_discount_amount: referralDiscountAmount,
                    original_amount: originalAmount,
                    referral_code: referralAttribution?.referral_code || null
                }
            });

            if (!settings.ton_wallet) return ctx.reply('❌ TON-кошелек не указан.');
            const { default: QRCode } = await import('qrcode');
            const nanoTon = Math.round(invoiceAmount * 1000000000);
            const tonUri = `ton://transfer/${settings.ton_wallet}?amount=${nanoTon}&text=${encodeURIComponent(memo)}`;
            const qrBuffer = await QRCode.toBuffer(tonUri, { errorCorrectionLevel: 'H', margin: 2, width: 400 });

            const discountLine = activeDiscountPercent > 0
                ? `\n🎉 Скидка: **-${activeDiscountPercent}%** (-${referralDiscountAmount} TON)\nЦена до скидки: **${originalAmount} TON**`
                : '';
            const caption = `💎 **СЧЕТ НА ОПЛАТУ (TON)**\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 Тариф: **${service.getTariffDisplayTitle(tariff)}**\n` +
                `⏳ Срок доступа: **${durationText}**\n` +
                `💰 Сумма к оплате: **${invoiceAmount} TON**${discountLine}\n\n` +
                `**Реквизиты для перевода:**\n` +
                `👛 Адрес: \`${settings.ton_wallet}\` (нажмите, чтобы скопировать)\n` +
                `💬 Комментарий (MEMO): \`${memo}\` (нажмите, чтобы скопировать)\n\n` +
                `⚠️ **ВАЖНО:** Вы должны обязательно указать комментарий \`${memo}\` при отправке TON, иначе система не сможет зачислить платеж автоматически.`;

            await ctx.deleteMessage().catch(() => {});
            await ctx.replyWithPhoto({ source: qrBuffer }, {
                caption: caption, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '💸 Оплатить в 1 клик', url: tonUri }], [{ text: '🔄 Проверить оплату', callback_data: `check_payment_${memo}` }], [{ text: '🔙 Назад', callback_data: 'back_to_main' }]]}
            });
        } catch (err) { console.error('Ошибка счета:', err); }
    };

    return { sendAdminMenu, sendUserMainMenu, sendMainMenu, createInvoiceForTariff };
}
