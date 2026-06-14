import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';

function isUserbotRetentionDmEnabled() {
    return String(process.env.USERBOT_RETENTION_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

function isOperationalUserbot(account) {
    return String(account?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

/**
 * Cron-задача: Напоминания за 24 часа до окончания подписки
 * Запускается каждые 5 минут, проверяет подписки которые истекают через 24ч
 * и отправляет напоминания (сначала ботом, если заблокирован - юзерботом)
 */

export const startRetention = (supabase, getBotFunction) => {
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    async function loadLatestUserbot(ownerId) {
        const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
        const { data, error } = await supabase
            .from('tg_accounts')
            .select('*, proxies(is_working)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return (data || []).find(account =>
            !reservedUserbotIds.has(String(account.id)) &&
            isOperationalUserbot(account) &&
            !(account.proxy_id && account.proxies?.is_working === false)
        ) || null;
    }

    setInterval(async () => {
        const now = new Date();
        // Ищем подписки, которые истекают в ближайшие 24 часа и напоминание для которых еще не отправлялось
        const targetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

        try {
            const { data: expiringSubs, error } = await supabase
                .from('subscriptions')
                .select(`id, tg_user_id, channel_id, channels ( owner_id, bot_id, title )`)
                .eq('status', 'active')
                .eq('expiry_reminder_sent', false)
                .lt('expires_at', targetTime)
                .gt('expires_at', now.toISOString())
                .limit(100);

            if (error || !expiringSubs || expiringSubs.length === 0) return;

            for (const sub of expiringSubs) {
                // Отмечаем как отправленное, чтобы избежать повторной обработки
                await supabase
                    .from('subscriptions')
                    .update({ expiry_reminder_sent: true })
                    .eq('id', sub.id);

                const ownerId = sub.channels.owner_id;
                const botId = sub.channels.bot_id;
                const bot = getBotFunction(botId);

                let sourceTariff = null;
                let upsellTariff = null;
                try {
                    const { data: recentInvoices } = await supabase
                        .from('invoices')
                        .select('id, tariff_id, paid_at, tariffs(id, title, is_trial, upsell_tariff_id, price, currency)')
                        .eq('tg_user_id', sub.tg_user_id)
                        .eq('status', 'paid')
                        .order('paid_at', { ascending: false })
                        .limit(20);

                    sourceTariff = (recentInvoices || []).find(invoice =>
                        invoice.tariffs &&
                        invoice.tariffs.is_trial
                    )?.tariffs || null;

                    if (sourceTariff?.upsell_tariff_id) {
                        const { data } = await supabase
                            .from('tariffs')
                            .select('id, title, price, currency')
                            .eq('id', sourceTariff.upsell_tariff_id)
                            .single();
                        upsellTariff = data || null;
                    }
                } catch (e) {
                    // Не валим удержание, если пробный сценарий не прочитался
                }

                // 1. Берем кастомный текст админа из базы
                const { data: settings } = await supabase.from('payment_settings').select('reminder_text').eq('owner_id', ownerId).single();

                // Дефолтный текст, если админ ничего не написал
                const defaultText = sourceTariff?.is_trial && upsellTariff
                    ? `⏳ **Пробник почти закончился**\n\nТвой доступ в «**{channel_name}**» скоро сгорит.\n\nЕсли хочешь остаться дальше, переходи в основной тариф:\n**{upsell_tariff_name}** — **{upsell_price} {upsell_currency}**\n\nЗайди в меню бота и оформи полный доступ.`
                    : `⏳ **Привет!**\n\nТвой доступ в закрытый канал «**{channel_name}**» закончится менее чем через 24 часа.\n\nЧтобы не потерять доступ, пожалуйста, зайди в меню и продли подписку!`;

                let rawText = (settings && settings.reminder_text) ? settings.reminder_text : defaultText;

                // Меняем плейсхолдер на реальное название канала
                const messageText = rawText
                    .replaceAll('{channel_name}', sub.channels.title)
                    .replaceAll('{upsell_tariff_name}', upsellTariff?.title || 'основной тариф')
                    .replaceAll('{upsell_price}', upsellTariff?.price || '')
                    .replaceAll('{upsell_currency}', upsellTariff?.currency || '');

                let sentByOfficialBot = false;

                // 2. Пробуем отправить официальным ботом
                if (bot) {
                    try {
                        await bot.telegram.sendMessage(sub.tg_user_id, messageText, { parse_mode: 'Markdown' });
                        sentByOfficialBot = true;
                        console.log(`[Напоминание] Успешно отправлено ботом юзеру ${sub.tg_user_id}`);
                    } catch (botErr) {
                        console.log(`[Напоминание] Бот заблокирован. Будим Юзербота для ${sub.tg_user_id}...`);
                    }
                }

                // 3. Если бот забанен - пробиваем в личку через Юзербота только при явном env-флаге
                if (!sentByOfficialBot) {
                    try {
                        if (!isUserbotRetentionDmEnabled()) {
                            console.log(`[Напоминание] USERBOT_RETENTION_DM_ENABLED=false, пропускаем ЛС через юзербота для ${sub.tg_user_id}`);
                        } else {
                            const userbot = await loadLatestUserbot(ownerId);
                            if (userbot) {
                                await userbotService.sendMessage(
                                    userbot,
                                    sub.tg_user_id.toString(),
                                    `🔔 **Системное уведомление!**\nМой бот не смог до тебя достучаться, пишу лично.\n\n${messageText}`,
                                    {
                                        event_source: 'retention',
                                        event_type: 'retention_reminder',
                                        channel_id: sub.channel_id || null,
                                        subscription_id: sub.id
                                    }
                                );
                                console.log(`[Напоминание] Доставлено через Юзербота юзеру ${sub.tg_user_id}`);
                            }
                        }
                    } catch (ubErr) {
                        console.error(`[Напоминание] Ошибка Юзербота:`, ubErr.message);
                    }
                }
            }
        } catch (err) { console.error('Ошибка в Cron-напоминаниях:', err.message); }
    }, 5 * 60 * 1000);
};
