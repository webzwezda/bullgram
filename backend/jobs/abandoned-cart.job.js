/**
 * Cron-задача: Брошенные корзины (Abandoned Cart) с умной защитой и скидками.
 * Запускается каждые 15 минут.
 */

export const startAbandonedCart = (supabase, getBotFunction) => {
    setInterval(async () => {
        const now = new Date();
        // Ищем счета старше 2 часов, но младше 3 часов
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

        try {
            const { data: abandonedInvoices, error } = await supabase
                .from('invoices')
                .select(`*, tariffs ( title, channel_id, is_trial, trial_label )`)
                .in('status', ['pending', 'awaiting_receipt'])
                .eq('reminded', false)
                .lte('created_at', twoHoursAgo)
                .gte('created_at', threeHoursAgo);

            if (error) throw error;
            if (!abandonedInvoices || abandonedInvoices.length === 0) return;

            for (const invoice of abandonedInvoices) {
                let channelId = invoice.tariffs?.channel_id || null;
                let botId = null;
                let ownerId = null;

                try {
                    // ЗАЩИТА №1: Проверяем, есть ли у юзера более НОВЫЕ счета на этот же тариф
                    const { data: newerInvoices } = await supabase
                        .from('invoices')
                        .select('id, status')
                        .eq('tg_user_id', invoice.tg_user_id)
                        .eq('tariff_id', invoice.tariff_id)
                        .gt('created_at', invoice.created_at);

                    // ЗАЩИТА №2: Проверяем, есть ли у юзера уже АКТИВНАЯ подписка на этот канал
                    const { data: activeSub } = await supabase
                        .from('subscriptions')
                        .select('id')
                        .eq('tg_user_id', invoice.tg_user_id)
                        .eq('channel_id', invoice.tariffs.channel_id)
                        .eq('status', 'active')
                        .maybeSingle();

                    // Если юзер уже пересоздал счет или уже подписан — просто "глушим" этот старый счет
                    if ((newerInvoices && newerInvoices.length > 0) || activeSub) {
                        await supabase.from('invoices').update({ reminded: true }).eq('id', invoice.id);

                        const skipReason = activeSub ? 'already_subscribed' : 'newer_invoice_exists';
                        try {
                            const { data: skipChannel } = channelId
                                ? await supabase.from('channels').select('bot_id, owner_id').eq('id', channelId).single()
                                : { data: null };
                            if (skipChannel) {
                                botId = skipChannel.bot_id;
                                ownerId = skipChannel.owner_id;
                            }
                            await supabase.from('access_events').insert({
                                owner_id: ownerId,
                                channel_id: channelId,
                                invoice_id: invoice.id,
                                tg_user_id: String(invoice.tg_user_id),
                                event_source: 'abandoned',
                                event_type: 'abandoned_reminder',
                                payload: {
                                    delivered_by: 'skipped',
                                    bot_id: botId,
                                    reason: skipReason
                                }
                            });
                        } catch (logErr) {
                            console.error('[Брошенная корзина] Не записали access_event (skipped):', logErr?.message || logErr);
                        }
                        continue;
                    }

                    // Получаем инфу о боте и настройках админа
                    const { data: channel } = await supabase
                        .from('channels')
                        .select('bot_id, owner_id')
                        .eq('id', invoice.tariffs.channel_id)
                        .single();

                    if (!channel) continue;

                    botId = channel.bot_id;
                    ownerId = channel.owner_id;

                    const bot = getBotFunction(botId);
                    if (!bot) continue;

                    const { data: settings } = await supabase
                        .from('payment_settings')
                        .select('abandoned_text, abandoned_discount_percent')
                        .eq('owner_id', ownerId)
                        .maybeSingle();

                    let discountPercent = settings?.abandoned_discount_percent || 0;
                    let newAmount = invoice.amount;
                    let oldAmount = invoice.amount;

                    // ПРИМЕНЯЕМ СКИДКУ, ЕСЛИ ОНА НАСТРОЕНА
                    if (discountPercent > 0) {
                        newAmount = invoice.amount - (invoice.amount * (discountPercent / 100));
                        // Округляем: для TON до 2 знаков, для RUB до целых
                        newAmount = invoice.currency === 'TON' ? parseFloat(newAmount.toFixed(2)) : Math.round(newAmount);

                        // Сохраняем новую (сниженную) сумму в чек в БД!
                        await supabase.from('invoices').update({ amount: newAmount }).eq('id', invoice.id);
                    }

                    const defaultText = invoice.tariffs?.is_trial
                        ? `🧪 **Ты почти забрал пробник**\n\nЯ увидел, что ты хотел зайти через «**{tariff_name}**», но не добил оплату.\n\nЕсли хочешь быстро посмотреть, что внутри, просто вернись в бота и закончи оплату.\n\n👉 *Пробник нужен, чтобы быстро зайти и принять решение. Не тяни.*`
                        : `🛒 **Привет!**\n\nЯ заметил, что ты хотел купить «**{tariff_name}**», но остановился.\n\n🎁 Только сейчас я даю тебе **скидку {discount_percent}%**!\nНовая цена: **{discount_price} {currency}** (вместо {old_price} {currency}).\n\n👉 *Жми кнопку ниже, чтобы забрать доступ!*`;

                    let rawText = (settings && settings.abandoned_text) ? settings.abandoned_text : defaultText;

                    // Подстановка переменных в текст
                    let messageText = rawText
                        .replace(/{tariff_name}/g, invoice.tariffs.trial_label || invoice.tariffs.title)
                        .replace(/{discount_percent}/g, discountPercent)
                        .replace(/{discount_price}/g, newAmount)
                        .replace(/{old_price}/g, oldAmount)
                        .replace(/{currency}/g, invoice.currency);

                    let botUsername = null;
                    try {
                        if (bot?.botInfo?.username) {
                            botUsername = bot.botInfo.username;
                        } else if (bot) {
                            const me = await bot.telegram.getMe();
                            botUsername = me?.username || null;
                        }
                    } catch (e) {
                        // не критично
                    }

                    // Отправляем дожим
                    await bot.telegram.sendMessage(invoice.tg_user_id, messageText, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💳 Оплатить со скидкой', callback_data: 'back_to_main' }]
                            ]
                        }
                    });

                    // Помечаем как обработанный
                    await supabase.from('invoices').update({ reminded: true }).eq('id', invoice.id);
                    console.log(`[Брошенная корзина] Успешный дожим (Скидка ${discountPercent}%) юзеру ${invoice.tg_user_id}`);

                    try {
                        await supabase.from('access_events').insert({
                            owner_id: ownerId,
                            channel_id: channelId,
                            invoice_id: invoice.id,
                            tg_user_id: String(invoice.tg_user_id),
                            event_source: 'abandoned',
                            event_type: 'abandoned_reminder',
                            payload: {
                                delivered_by: 'bot',
                                bot_id: botId,
                                bot_username: botUsername,
                                tariff_id: invoice.tariff_id || null,
                                message_text: messageText,
                                discount_percent: discountPercent,
                                original_amount: oldAmount,
                                discounted_amount: newAmount,
                                currency: invoice.currency
                            }
                        });
                    } catch (logErr) {
                        console.error('[Брошенная корзина] Не записали access_event (bot):', logErr?.message || logErr);
                    }

                } catch (sendErr) {
                    console.error(`[Брошенная корзина] Ошибка юзеру ${invoice.tg_user_id}:`, sendErr.message);
                    try {
                        if (channelId) {
                            const { data: errChannel } = await supabase.from('channels').select('bot_id, owner_id').eq('id', channelId).single();
                            if (errChannel) {
                                botId = errChannel.bot_id;
                                ownerId = errChannel.owner_id;
                            }
                        }
                        await supabase.from('access_events').insert({
                            owner_id: ownerId,
                            channel_id: channelId,
                            invoice_id: invoice.id,
                            tg_user_id: String(invoice.tg_user_id),
                            event_source: 'abandoned',
                            event_type: 'abandoned_reminder',
                            payload: {
                                delivered_by: 'failed',
                                bot_id: botId,
                                error: sendErr?.message || 'unknown'
                            }
                        });
                    } catch (logErr) {
                        console.error('[Брошенная корзина] Не записали access_event (failed):', logErr?.message || logErr);
                    }
                }
            }
        } catch (err) {
            console.error('Ошибка в Cron-Брошенные корзины:', err.message);
        }
    }, 15 * 60 * 1000); // Проверка каждые 15 минут
};
