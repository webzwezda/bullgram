/**
 * Cron-задача: Автоматический кик истекших подписок
 * Запускается каждые 5 минут, проверяет подписки с истекшим сроком
 * и исключает пользователей из каналов
 */
import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { MessagingRouter, isActorEligible } from '../services/messaging-router.service.js';

function isUserbotAutoKickDmEnabled() {
    return String(process.env.USERBOT_AUTO_KICK_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

function isUserbotAutoKickFallbackEnabled() {
    return String(process.env.USERBOT_AUTO_KICK_FALLBACK_ENABLED || '').trim().toLowerCase() === 'true';
}

function isOperationalUserbot(account) {
    return String(account?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

export const startAutoKick = (supabase, getBotFunction, { messagingRouter: messagingRouterOverride } = {}) => {
    const messagingRouter = messagingRouterOverride || new MessagingRouter({ supabase });

    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    // Контурный пул бота: те же акторы, что и в retention-фолбэке (активные связки, без shop-резерва)
    async function loadContourPool(ownerId, botId) {
        const [reservedUserbotIds, bindingsResponse] = await Promise.all([
            loadReservedUserbotIds(supabase, ownerId),
            supabase
                .from('official_bot_userbot_bindings')
                .select('userbot_id')
                .eq('bot_id', botId)
                .eq('is_active', true)
        ]);
        if (bindingsResponse.error) throw bindingsResponse.error;

        const userbotIds = [...new Set((bindingsResponse.data || []).map((row) => String(row.userbot_id)))].filter(Boolean);
        if (userbotIds.length === 0) return [];

        const { data, error } = await supabase
            .from('tg_accounts')
            .select('*, proxies(is_working)')
            .eq('owner_id', ownerId)
            .eq('account_type', 'userbot')
            .in('id', userbotIds);
        if (error) throw error;

        const now = new Date();
        return (data || []).filter((account) =>
            !reservedUserbotIds.has(String(account.id)) && isActorEligible(account, { now })
        );
    }

    // Пул ЛС после кика: контурные акторы бота; пусто — последний рабочий юзербот пулом из одного
    async function loadKickDmPool(ownerId, botId) {
        if (botId) {
            try {
                const contourPool = await loadContourPool(ownerId, botId);
                if (contourPool.length > 0) return contourPool;
            } catch (poolErr) {
                console.error('[AutoKick] Не собрали контурный пул для ЛС, падаем на последний юзербот:', poolErr?.message || poolErr);
            }
        }
        const latest = await loadLatestUserbot(ownerId);
        return latest ? [latest] : [];
    }

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
                .select(`id, tg_user_id, channel_id, kick_attempts, channels ( tg_chat_id, bot_id, owner_id, title )`)
                .eq('status', 'active')
                .lt('expires_at', now)
                .lt('kick_attempts', 5)
                .limit(100);

            if (error) throw error;
            if (!expiredSubs || expiredSubs.length === 0) return;

            for (const sub of expiredSubs) {
                const botId = sub.channels.bot_id;
                const chatId = sub.channels.tg_chat_id;
                const bot = getBotFunction(botId);
                let kicked = false;
                let kickErrors = [];

                if (bot) {
                    try {
                        await bot.telegram.banChatMember(chatId, sub.tg_user_id);
                        await bot.telegram.unbanChatMember(chatId, sub.tg_user_id);
                        kicked = true;
                    } catch (kickError) {
                        const errMsg = `Официальный бот: ${kickError.message}`;
                        console.error(`[AutoKick] ${errMsg} (${sub.tg_user_id})`);
                        kickErrors.push(errMsg);
                    }
                }

                if (!kicked && isUserbotAutoKickFallbackEnabled()) {
                    try {
                        const userbot = await loadLatestUserbot(sub.channels.owner_id);

                        if (userbot) {
                            await userbotService.kickMemberFromChannel(userbot, chatId, sub.tg_user_id);
                            kicked = true;
                        } else {
                            kickErrors.push('Юзербот: Нет доступного юзербота для кика');
                        }
                    } catch (userbotKickError) {
                        const errMsg = `Юзербот: ${userbotKickError.message}`;
                        console.error(`[AutoKick] ${errMsg} (${sub.tg_user_id})`);
                        kickErrors.push(errMsg);
                    }
                } else if (!kicked) {
                    console.log(`[AutoKick] USERBOT_AUTO_KICK_FALLBACK_ENABLED=false, не исключаем ${sub.tg_user_id} через юзербота автоматически`);
                    kickErrors.push('Юзербот-фоллбэк выключен в конфигурации');
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
                            const pool = await loadKickDmPool(sub.channels.owner_id, botId);

                            if (pool.length > 0) {
                                const result = await messagingRouter.deliver({
                                    ownerId: sub.channels.owner_id,
                                    tgUserId: sub.tg_user_id.toString(),
                                    text: `😢 Твоя подписка на «${sub.channels.title || 'закрытый канал'}» истекла, и доступ был отключен. Напиши боту снова, чтобы продлить подписку.`,
                                    pool,
                                    eventSource: 'auto_kick'
                                });
                                if (result.status !== 'sent') {
                                    console.warn(`[AutoKick] Юзербот-пул не доставил ЛС ${sub.tg_user_id}: ${result.errorKind} ${result.errorText || ''}`);
                                }
                            } else {
                                console.warn(`[AutoKick] Нет рабочего юзербота для ЛС ${sub.tg_user_id}`);
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
                        access_note: 'Исключен системой после окончания подписки',
                        kick_failed_reason: null
                    }).eq('id', sub.id);
                } else {
                    const newAttempts = (sub.kick_attempts || 0) + 1;
                    const reason = kickErrors.join('; ');
                    await supabase.from('subscriptions').update({
                        kick_attempts: newAttempts,
                        kick_failed_reason: reason,
                        access_note: `Не удалось исключить (попытка ${newAttempts}/5): ${reason}`
                    }).eq('id', sub.id);
                }
            }
        } catch (err) { console.error('Ошибка в AutoKick Cron:', err.message); }
    }, 5 * 60 * 1000);
};
