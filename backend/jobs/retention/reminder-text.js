/**
 * Сборка тарифа и текста retention-напоминания — вынесена из retention.job.js
 * без изменения поведения (разрезка под pre-commit лимит 20KB). Чистая сборка:
 * (supabase, sub, ownerId, bot) → { sourceTariff, upsellTariff, renewalTariffId,
 * botUsername, renewalLink, messageText } — ровно те переменные, что использует
 * главный цикл после этого блока.
 */
export async function buildReminderContent(supabase, sub, ownerId, bot) {
    let sourceTariff = null;
    let upsellTariff = null;
    let lastPaidTariff = null;
    try {
        // Скоуп по владельцу: чужие инвойсы и тарифы не должны влиять на текст и deep-link
        const { data: recentInvoices } = await supabase
            .from('invoices')
            .select('id, tariff_id, paid_at, tariffs!inner(id, title, is_trial, upsell_tariff_id, price, currency)')
            .eq('tg_user_id', sub.tg_user_id)
            .eq('status', 'paid')
            .eq('tariffs.owner_id', ownerId)
            .order('paid_at', { ascending: false })
            .limit(20);

        sourceTariff = (recentInvoices || []).find(invoice =>
            invoice.tariffs &&
            invoice.tariffs.is_trial
        )?.tariffs || null;

        lastPaidTariff = (recentInvoices || []).find(invoice =>
            invoice.tariffs && !invoice.tariffs.is_trial
        )?.tariffs || null;

        if (sourceTariff?.upsell_tariff_id) {
            const { data } = await supabase
                .from('tariffs')
                .select('id, title, price, currency')
                .eq('id', sourceTariff.upsell_tariff_id)
                .eq('owner_id', ownerId)
                .maybeSingle();
            upsellTariff = data || null;
        }
    } catch (e) {
        // Не валим удержание, если пробный сценарий не прочитался
    }

    // 1. Берем кастомный текст админа из базы
    const { data: settings } = await supabase.from('payment_settings').select('reminder_text').eq('owner_id', ownerId).single();

    // Дефолтный текст, если админ ничего не написал (жирный в legacy Markdown — одиночная *, двойная ** ломает parse_mode)
    const defaultText = sourceTariff?.is_trial && upsellTariff
        ? `⏳ *Пробник почти закончился*\n\nТвой доступ в «*{channel_name}*» скоро сгорит.\n\nЕсли хочешь остаться дальше, переходи в основной тариф:\n*{upsell_tariff_name}* — *{upsell_price} {upsell_currency}*\n\n👉 {renewal_link}`
        : `⏳ *Привет!*\n\nТвой доступ в закрытый канал «*{channel_name}*» закончится менее чем через 24 часа.\n\nЧтобы не потерять доступ, продли в один клик:\n👉 {renewal_link}\n\n_Если уже оплатил — просто проигнорируй это сообщение._`;

    let rawText = (settings && settings.reminder_text) ? settings.reminder_text : defaultText;

    // Определяем тариф для продления и строим deep-link
    let renewalTariffId = null;
    if (sourceTariff?.is_trial && upsellTariff) {
        renewalTariffId = upsellTariff.id;
    } else if (lastPaidTariff?.id) {
        renewalTariffId = lastPaidTariff.id;
    }

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

    let renewalLink = null;
    if (botUsername) {
        renewalLink = renewalTariffId
            ? `https://t.me/${botUsername}?start=buy_${renewalTariffId}`
            : `https://t.me/${botUsername}`;
    } else {
        // Нет юзернейма бота — убираем строку со ссылкой, чтобы не отправить литеральный {renewal_link}
        console.warn(`[Напоминание] botUsername недоступен, убираем ссылку на продление из текста (subscription ${sub.id})`);
        rawText = rawText
            .split('\n')
            .filter(line => !line.includes('{renewal_link}'))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // Меняем плейсхолдеры на реальные значения
    const messageText = rawText
        .replaceAll('{channel_name}', sub.channels.title)
        .replaceAll('{upsell_tariff_name}', upsellTariff?.title || 'основной тариф')
        .replaceAll('{upsell_price}', upsellTariff?.price || '')
        .replaceAll('{upsell_currency}', upsellTariff?.currency || '')
        .replaceAll('{renewal_link}', renewalLink || '');

    return { sourceTariff, upsellTariff, renewalTariffId, botUsername, renewalLink, messageText };
}
