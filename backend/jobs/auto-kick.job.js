/**
 * Cron-задача: Автоматический кик истекших подписок
 * Запускается каждые 5 минут, проверяет подписки с истекшим сроком
 * и исключает пользователей из каналов
 */
import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';

function isUserbotAutoKickDmEnabled() {
    return String(process.env.USERBOT_AUTO_KICK_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

function isUserbotAutoKickFallbackEnabled() {
    return String(process.env.USERBOT_AUTO_KICK_FALLBACK_ENABLED || '').trim().toLowerCase() === 'true';
}

function isOperationalUserbot(account) {
    return String(account?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

export const startAutoKick = (supabase, getBotFunction) => {
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
        const now = new Date().toISOString();
        try {
            const { data: expiredSubs, error } = await supabase
                .from('subscriptions')
                .select(`id, tg_user_id, channel_id, channels ( tg_chat_id, bot_id, owner_id, title )`)
                .eq('status', 'active')
                .lt('expires_at', now);

            if (error) throw error;
            if (!expiredSubs || expiredSubs.length === 0) return;

            for (const sub of expiredSubs) {
                const botId = sub.channels.bot_id;
                const chatId = sub.channels.tg_chat_id;
                const bot = getBotFunction(botId);
                let kicked = false;

                if (bot) {
                    try {
                        await bot.telegram.banChatMember(chatId, sub.tg_user_id);
                        await bot.telegram.unbanChatMember(chatId, sub.tg_user_id);
                        kicked = true;
                    } catch (kickError) {
                        console.error(`[AutoKick] Официальный бот не смог исключить ${sub.tg_user_id}:`, kickError.message);
                    }
                }

                if (!kicked && isUserbotAutoKickFallbackEnabled()) {
                    try {
                        const userbot = await loadLatestUserbot(sub.channels.owner_id);

                        if (userbot) {
                            await userbotService.kickMemberFromChannel(userbot, chatId, sub.tg_user_id);
                            kicked = true;
                        }
                    } catch (userbotKickError) {
                        console.error(`[AutoKick] Юзербот не смог исключить ${sub.tg_user_id}:`, userbotKickError.message);
                    }
                } else if (!kicked) {
                    console.log(`[AutoKick] USERBOT_AUTO_KICK_FALLBACK_ENABLED=false, не исключаем ${sub.tg_user_id} через юзербота автоматически`);
                }

                if (kicked) {
                    await supabase.from('access_events').insert({
                        owner_id: sub.channels.owner_id,
                        channel_id: sub.channel_id,
                        subscription_id: sub.id,
                        tg_user_id: String(sub.tg_user_id),
                        event_type: 'kicked',
                        event_source: bot ? 'official_bot' : 'userbot',
                        payload: {
                            chat_id: String(chatId)
                        }
                    });

                    try {
                        if (bot) {
                            await bot.telegram.sendMessage(sub.tg_user_id, '😢 Твоя подписка истекла, и ты был исключен.\nНажми /start чтобы вернуться!');
                        } else if (isUserbotAutoKickDmEnabled()) {
                            const userbot = await loadLatestUserbot(sub.channels.owner_id);

                            if (userbot) {
                                await userbotService.sendMessage(
                                    userbot,
                                    sub.tg_user_id,
                                    `😢 Твоя подписка на «${sub.channels.title || 'закрытый канал'}» истекла, и доступ был отключен. Напиши боту снова, чтобы продлить подписку.`,
                                    {
                                        event_source: 'auto_kick',
                                        event_type: 'expired_notice',
                                        channel_id: sub.channel_id || null,
                                        subscription_id: sub.id
                                    }
                                );
                            }
                        } else {
                            console.log(`[AutoKick] USERBOT_AUTO_KICK_DM_ENABLED=false, пропускаем ЛС через юзербота для ${sub.tg_user_id}`);
                        }
                    } catch (notifyError) {
                        console.error(`[AutoKick] Не удалось уведомить ${sub.tg_user_id}:`, notifyError.message);
                    }

                    await supabase.from('subscriptions').update({
                        status: 'expired',
                        last_access_event: 'kicked',
                        access_note: 'Исключен системой после окончания подписки'
                    }).eq('id', sub.id);
                }
            }
        } catch (err) { console.error('Ошибка в AutoKick Cron:', err.message); }
    }, 5 * 60 * 1000);
};
