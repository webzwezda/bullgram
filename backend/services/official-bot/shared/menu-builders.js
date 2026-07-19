import QRCode from 'qrcode';
import escapeHtml from 'escape-html';
import { tonToNano } from '../../../utils/ton.js';

const INVOICE_REUSE_WINDOW_MS = 5 * 60 * 1000;
const INVOICE_TTL_MS = 15 * 60 * 1000;

function pluralizeDays(days) {
    const n = Math.abs(Number(days) || 0);
    if (n === 0) return 'Навсегда';
    const lastTwo = n % 100;
    const last = n % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return `${n} дней`;
    if (last === 1) return `${n} день`;
    if (last >= 2 && last <= 4) return `${n} дня`;
    return `${n} дней`;
}

function generateMemo() {
    return 'sub_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function isUniqueViolation(err) {
    const code = String(err?.code || '');
    const message = String(err?.message || '');
    return code === '23505' || message.includes('duplicate key') || message.includes('unique');
}

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

    const activateFreeTariff = async (ctx, tariff) => {
        const userId = ctx.from.id;
        const nowIso = new Date().toISOString();
        const memo = generateMemo();

        const { data: invoice, error } = await service.supabase
            .from('invoices')
            .insert({
                tg_user_id: userId,
                tariff_id: tariff.id,
                amount: 0,
                currency: tariff.currency,
                memo,
                status: 'paid',
                paid_at: nowIso,
                verified_at: nowIso,
                expires_at: nowIso
            })
            .select('*')
            .single();

        if (error) {
            console.error('free invoice insert:', error.message);
            await ctx.reply('❌ Не удалось открыть доступ. Попробуйте позже.').catch(() => {});
            return null;
        }

        await service.logPaymentEvent({
            ownerId: tariff.owner_id,
            invoiceId: invoice.id,
            provider: 'manual_ton',
            eventType: 'free_activated',
            status: 'paid',
            payload: { tariff_id: tariff.id, amount: 0 }
        });

        await service.logCustomerFunnelEvent({
            ownerId: tariff.owner_id,
            botId,
            tgUserId: userId,
            tariffId: tariff.id,
            eventType: 'free_activated',
            sessionKey: service.buildCustomerFunnelSessionKey({
                botId,
                tgUserId: userId,
                eventType: 'free_activated',
                tariffId: tariff.id
            }),
            payload: { invoice_id: invoice.id }
        });

        await ctx.deleteMessage().catch(() => {});
        // activateSubscription (called by the handler) sends its own message
        // with invite links / resources — no separate "ДОСТУП ОТКРЫТ" message here.
        return { invoice };
    };

    const createInvoiceForTariff = async (ctx, tariff) => {
        try {
            // Free tariff: skip QR/invoice, create a paid 0-amount invoice immediately.
            if (Number(tariff.price || 0) === 0) {
                return activateFreeTariff(ctx, tariff);
            }

            const durationText = pluralizeDays(tariff.duration_days);

            const { data: settings, error: settingsErr } = await service.supabase
                .from('payment_settings')
                .select('ton_wallet')
                .eq('owner_id', tariff.owner_id)
                .maybeSingle();
            if (settingsErr) console.error('payment_settings load:', settingsErr.message);
            if (!settings?.ton_wallet) {
                return ctx.reply('❌ У продавца не настроен TON-кошелёк. Оплата через бота недоступна.');
            }

            const userId = ctx.from.id;
            const referralAttribution = await service.getActiveReferralAttribution(tariff.owner_id, userId);
            const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
            const browseDiscountPercent = await service.getBrowseFollowupDiscount(tariff.owner_id, userId);
            const activeDiscountPercent = Math.max(referralDiscountPercent, browseDiscountPercent);
            const originalAmount = Number(tariff.price || 0);
            const invoiceAmount = service.formatDiscountedAmount(originalAmount, tariff.currency, activeDiscountPercent);

            // Идемпотентность: если у юзера уже есть свежий pending-счёт на этот тариф с той же суммой — переиспользуем.
            const { data: recentPending } = await service.supabase
                .from('invoices')
                .select('id, memo, amount, created_at')
                .eq('tg_user_id', userId)
                .eq('tariff_id', tariff.id)
                .eq('status', 'pending')
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const canReuse = recentPending
                && Date.now() - new Date(recentPending.created_at).getTime() < INVOICE_REUSE_WINDOW_MS
                && Math.abs(Number(recentPending.amount) - invoiceAmount) < 1e-6;

            let memo;
            let invoiceId = null;

            if (canReuse) {
                memo = recentPending.memo;
                invoiceId = recentPending.id;
            } else {
                // Atomic INSERT + SELECT с retry на unique violation (23505) — крайне редкий, но возможный.
                let createdInvoice = null;
                let insertErr = null;
                for (let attempt = 0; attempt < 3 && !createdInvoice; attempt++) {
                    memo = generateMemo();
                    ({ data: createdInvoice, error: insertErr } = await service.supabase
                        .from('invoices')
                        .insert({
                            tg_user_id: userId,
                            tariff_id: tariff.id,
                            amount: invoiceAmount,
                            currency: tariff.currency,
                            memo,
                            status: 'pending',
                            expires_at: new Date(Date.now() + INVOICE_TTL_MS).toISOString()
                        })
                        .select('id')
                        .single());
                    if (insertErr && !isUniqueViolation(insertErr)) break;
                }
                if (insertErr || !createdInvoice) {
                    console.error('INSERT invoice failed:', insertErr?.message || 'no rows');
                    return ctx.reply('❌ Не удалось создать счёт. Попробуйте позже.');
                }
                invoiceId = createdInvoice.id;

                const referralDiscountAmount = Number((originalAmount - invoiceAmount).toFixed(4));

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
                        invoice_id: invoiceId,
                        amount: invoiceAmount,
                        currency: tariff.currency,
                        original_amount: originalAmount,
                        referral_discount_percent: activeDiscountPercent
                    }
                });

                await service.logPaymentEvent({
                    ownerId: tariff.owner_id,
                    invoiceId,
                    provider: 'manual_ton',
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
            }

            const nanoTon = tonToNano(invoiceAmount);
            const tonUri = `ton://transfer/${settings.ton_wallet}?amount=${nanoTon}&text=${encodeURIComponent(memo)}`;
            const qrBuffer = await QRCode.toBuffer(tonUri, { errorCorrectionLevel: 'H', margin: 2, width: 400 });

            const publicAppOrigin = process.env.PUBLIC_APP_ORIGIN;
            const payUrl = publicAppOrigin ? `${publicAppOrigin}/pay/${invoiceId}` : null;

            const escapedTitle = escapeHtml(service.getTariffDisplayTitle(tariff));
            const escapedWallet = escapeHtml(settings.ton_wallet);
            const escapedMemo = escapeHtml(memo);
            const discountLine = activeDiscountPercent > 0
                ? `\n🎉 Скидка: <b>-${activeDiscountPercent}%</b> (до скидки: ${originalAmount} TON)`
                : '';

            const sitePayLine = payUrl
                ? `\n💳 Или оплатите на сайте: ${payUrl}\n`
                : '\n';

            const caption = `💎 <b>СЧЕТ НА ОПЛАТУ (TON)</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 Тариф: <b>${escapedTitle}</b>\n` +
                `⏳ Срок доступа: <b>${durationText}</b>\n` +
                `💰 Сумма: <b>${invoiceAmount} TON</b>${discountLine}\n\n` +
                `Отсканируйте QR или жмите «💸 Открыть кошелёк» — откроется ваш TON-кошелёк с заполненным переводом. Для оплаты с компьютера используйте «💳 Оплатить на сайте».\n\n` +
                `👛 Адрес: <code>${escapedWallet}</code>\n` +
                `💬 MEMO: <code>${escapedMemo}</code>\n` +
                sitePayLine +
                `\n⏳ Счёт действителен 15 минут. После перевода подписка активируется автоматически в течение ~1 минуты — кнопку «Проверить оплату» можно не нажимать.`;

            const inlineKeyboard = [
                [{ text: '💸 Открыть кошелёк', url: tonUri }]
            ];
            if (payUrl) {
                inlineKeyboard.push([{ text: '💳 Оплатить на сайте', url: payUrl }]);
            }
            inlineKeyboard.push(
                [{ text: '🔄 Проверить оплату', callback_data: `check_payment_${memo}` }],
                [{ text: '🔙 К тарифам', callback_data: 'buy_tariff' }]
            );

            await ctx.deleteMessage().catch(() => {});
            await ctx.replyWithPhoto({ source: qrBuffer }, {
                caption,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
        } catch (err) {
            console.error('Ошибка создания счёта:', err);
            await ctx.reply('❌ Не удалось создать счёт. Попробуйте позже или свяжитесь с продавцом.').catch(() => {});
        }
    };

    return { sendAdminMenu, sendUserMainMenu, sendMainMenu, createInvoiceForTariff };
}
