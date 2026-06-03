/**
 * Cron-задача: Дожим при просмотре тарифов (Browse Follow-up).
 * Запускается каждые 15 минут.
 *
 * Ищет customer_funnel_events с типом tariff_list_opened / tariff_card_opened,
 * которые старше 1 часа но младше 2 часов, и где юзер не создал инвойс и не купил.
 * Отправляет push-сообщение со скидкой и кнопкой "Выбрать тариф".
 */

export const startBrowseFollowup = (supabase, getBotFunction) => {
    setInterval(async () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

        try {
            const { data: browseEvents, error } = await supabase
                .from('customer_funnel_events')
                .select('*')
                .in('event_type', ['tariff_list_opened', 'tariff_card_opened'])
                .eq('followed_up', false)
                .eq('source', 'official_bot')
                .not('bot_id', 'is', null)
                .lte('created_at', oneHourAgo)
                .gte('created_at', twoHoursAgo);

            if (error) throw error;
            if (!browseEvents || browseEvents.length === 0) return;

            // Дедупликация: 1 follow-up на (owner_id, tg_user_id), берём самое свежее
            const deduped = new Map();
            for (const ev of browseEvents) {
                const key = `${ev.owner_id}:${ev.tg_user_id}`;
                if (!deduped.has(key) || new Date(ev.created_at) > new Date(deduped.get(key).created_at)) {
                    deduped.set(key, ev);
                }
            }

            for (const event of deduped.values()) {
                try {
                    // ЗАЩИТА 1: Юзер создал инвойс после просмотра?
                    const { data: invoicesAfter } = await supabase
                        .from('invoices')
                        .select('id, status, created_at, tariffs!inner(owner_id)')
                        .eq('tg_user_id', event.tg_user_id)
                        .gte('created_at', event.created_at);

                    const ownerInvoices = (invoicesAfter || []).filter(
                        inv => inv.tariffs?.owner_id === event.owner_id
                    );
                    if (ownerInvoices.length > 0) {
                        await supabase.from('customer_funnel_events')
                            .update({ followed_up: true }).eq('id', event.id);
                        continue;
                    }

                    // ЗАЩИТА 2: Есть активная подписка на каналы этого owner?
                    const { data: ownerChannels } = await supabase
                        .from('channels')
                        .select('id')
                        .eq('owner_id', event.owner_id);
                    const channelIds = (ownerChannels || []).map(c => c.id);

                    if (channelIds.length > 0) {
                        const { data: activeSub } = await supabase
                            .from('subscriptions')
                            .select('id')
                            .eq('tg_user_id', event.tg_user_id)
                            .in('channel_id', channelIds)
                            .eq('status', 'active')
                            .maybeSingle();
                        if (activeSub) {
                            await supabase.from('customer_funnel_events')
                                .update({ followed_up: true }).eq('id', event.id);
                            continue;
                        }
                    }

                    // ЗАЩИТА 3: Уже получил abandoned-cart дожим?
                    const { data: remindedInvoices } = await supabase
                        .from('invoices')
                        .select('id, tariffs!inner(owner_id)')
                        .eq('tg_user_id', event.tg_user_id)
                        .eq('reminded', true);
                    const hasRemindedForOwner = (remindedInvoices || []).some(
                        inv => inv.tariffs?.owner_id === event.owner_id
                    );
                    if (hasRemindedForOwner) {
                        await supabase.from('customer_funnel_events')
                            .update({ followed_up: true }).eq('id', event.id);
                        continue;
                    }

                    // Получаем бот
                    const bot = getBotFunction(event.bot_id);
                    if (!bot) {
                        await supabase.from('customer_funnel_events')
                            .update({ followed_up: true }).eq('id', event.id);
                        continue;
                    }

                    // Настройки админа
                    const { data: settings } = await supabase
                        .from('payment_settings')
                        .select('abandoned_text, abandoned_discount_percent')
                        .eq('owner_id', event.owner_id)
                        .maybeSingle();

                    const discountPercent = settings?.abandoned_discount_percent || 0;

                    // Формируем сообщение
                    let messageText;
                    let buttonText;

                    if (event.tariff_id) {
                        // tariff_card_opened — конкретный тариф известен
                        const { data: tariff } = await supabase
                            .from('tariffs')
                            .select('*')
                            .eq('id', event.tariff_id)
                            .single();

                        if (tariff) {
                            const oldPrice = Number(tariff.price);
                            const newPrice = discountPercent > 0
                                ? (tariff.currency === 'TON'
                                    ? parseFloat((oldPrice * (1 - discountPercent / 100)).toFixed(2))
                                    : Math.round(oldPrice * (1 - discountPercent / 100)))
                                : oldPrice;

                            const defaultText = `👀 **Привет!**\n\nЯ заметил, что ты смотрел тариф «**{tariff_name}**», но не завершил оформление.\n\n${discountPercent > 0 ? `🎁 Специально для тебя — скидка **{discount_percent}%**!\nНовая цена: **{discount_price} {currency}** (вместо {old_price} {currency}).\n\n` : ''}👉 *Жми кнопку ниже, чтобы забрать доступ${discountPercent > 0 ? ' со скидкой' : ''}!*`;

                            const rawText = settings?.abandoned_text || defaultText;
                            messageText = rawText
                                .replace(/{tariff_name}/g, tariff.trial_label || tariff.title)
                                .replace(/{discount_percent}/g, discountPercent)
                                .replace(/{discount_price}/g, newPrice)
                                .replace(/{old_price}/g, oldPrice)
                                .replace(/{currency}/g, tariff.currency);
                            buttonText = '💳 Оплатить со скидкой';
                        }
                    }

                    if (!messageText) {
                        // tariff_list_opened или тариф удалён — generic сообщение
                        const genericDefault = `👀 **Привет!**\n\nЯ заметил, что ты смотрел мои тарифы, но не выбрал подходящий.\n\n${discountPercent > 0 ? `🎁 Специально для тебя — скидка **${discountPercent}%** на любой тариф!\n\n` : ''}👉 *Жми кнопку ниже, чтобы посмотреть варианты${discountPercent > 0 ? ' со скидкой' : ''}.*`;
                        messageText = genericDefault;
                        buttonText = '💳 Смотреть тарифы';
                    }

                    // Отправляем дожим
                    await bot.telegram.sendMessage(event.tg_user_id, messageText, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: buttonText, callback_data: 'buy_tariff' }]
                            ]
                        }
                    });

                    // Помечаем как обработанное
                    await supabase.from('customer_funnel_events')
                        .update({ followed_up: true }).eq('id', event.id);
                    console.log(`[Browse follow-up] Отправлен push юзеру ${event.tg_user_id} (скидка ${discountPercent}%)`);

                } catch (sendErr) {
                    console.error(`[Browse follow-up] Ошибка для юзера ${event.tg_user_id}:`, sendErr.message);
                }
            }
        } catch (err) {
            console.error('Ошибка в cron browse follow-up:', err.message);
        }
    }, 15 * 60 * 1000);
};
