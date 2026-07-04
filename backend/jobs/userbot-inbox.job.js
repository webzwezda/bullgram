import { UserbotService } from '../services/userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';

const publicAppOrigin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullgram.xyz').replace(/\/$/, '');

function isUserbotInboxWatchEnabled() {
    return String(process.env.USERBOT_INBOX_WATCH_ENABLED || '').trim().toLowerCase() === 'true';
}

function detectSalesSignal(text = '') {
    const value = String(text || '').toLowerCase();
    if (!value.trim()) return false;

    const keywords = [
        'куп', 'покуп', 'куплю', 'хочу', 'интерес', 'интересно',
        'цена', 'сколько', 'оплат', 'оплачу', 'ton', 'usdt',
        'доступ', 'продл', 'подписк', 'как купить', 'как оплатить'
    ];

    return keywords.some(keyword => value.includes(keyword));
}

function escapeHtml(value = '') {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function isOperationalUserbot(userbot) {
    return String(userbot?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

export const startUserbotInboxWatch = (supabase, getBotFunction) => {
    if (!isUserbotInboxWatchEnabled()) {
        console.log('[UserbotInboxWatch] disabled by USERBOT_INBOX_WATCH_ENABLED flag');
        return;
    }

    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    setInterval(async () => {
        try {
            const { data: paymentSettings, error: settingsError } = await supabase
                .from('payment_settings')
                .select('owner_id, admin_tg_id')
                .not('admin_tg_id', 'is', null);

            if (settingsError || !paymentSettings || paymentSettings.length === 0) return;

            for (const settings of paymentSettings) {
                const ownerId = settings.owner_id;
                const adminTgId = String(settings.admin_tg_id || '').trim();
                if (!adminTgId) continue;

                const { data: opsBots } = await supabase
                    .from('tg_accounts')
                    .select('id, tg_username')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'bot')
                    .eq('bot_role', 'ops')
                    .order('created_at', { ascending: true })
                    .limit(1);

                const opsBot = opsBots?.[0];
                const bot = opsBot ? getBotFunction(opsBot.id) : null;
                if (!bot) continue;

                const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
                const { data: userbots, error: userbotsError } = await supabase
                    .from('tg_accounts')
                    .select('*, proxies(is_working)')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
                    .order('created_at', { ascending: false });

                if (userbotsError || !userbots?.length) continue;

                const operationalUserbots = userbots.filter(userbot =>
                    !reservedUserbotIds.has(String(userbot.id)) &&
                    isOperationalUserbot(userbot) &&
                    !(userbot.proxy_id && userbot.proxies?.is_working === false)
                );

                for (const userbot of operationalUserbots) {
                    let client = null;
                    try {
                        client = await userbotService.createAuthorizedClient(userbot, 1);
                        const dialogs = await client.getDialogs({ limit: 25 });

                        for (const dialog of dialogs) {
                            const entity = dialog.entity;
                            if (!entity || entity.className !== 'User' || entity.bot || entity.self) continue;

                            const unreadCount = Number(dialog.unreadCount || 0);
                            const preview = String(dialog?.message?.message || '').trim();
                            const isIncoming = !dialog?.message?.out;
                            const isHot = unreadCount > 0 || (isIncoming && detectSalesSignal(preview));
                            if (!isHot) continue;

                            const lastMessageId = String(dialog?.message?.id || '');
                            if (!lastMessageId) continue;

                            const dialogTgUserId = String(entity.id);

                            const { data: existing, error: existingError } = await supabase
                                .from('userbot_inbox_notifications')
                                .select('id')
                                .eq('owner_id', ownerId)
                                .eq('userbot_id', userbot.id)
                                .eq('dialog_tg_user_id', dialogTgUserId)
                                .eq('last_message_id', lastMessageId)
                                .maybeSingle();

                            if (existingError) throw existingError;
                            if (existing) continue;

                            const displayName = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim() || entity.username || `ID ${entity.id}`;
                            const safeDisplayName = escapeHtml(displayName);
                            const safeUsername = entity.username ? escapeHtml(entity.username) : '';
                            const safePreview = escapeHtml(preview || 'Telegram не отдал текст сообщения.');
                            const deepLink = `${publicAppOrigin}/app/userbot-center?userbot_id=${encodeURIComponent(userbot.id)}`;

                            await bot.telegram.sendMessage(
                                adminTgId,
                                `🧭 <b>Юзербот словил новое входящее</b>\n\n<b>Аккаунт:</b> @${userbot.tg_username || userbot.tg_account_id}\n<b>Кто пишет:</b> ${safeDisplayName}${safeUsername ? ` • @${safeUsername}` : ''}\n<b>TG ID:</b> <code>${dialogTgUserId}</code>\n<b>Непрочитано:</b> ${unreadCount}\n\n<b>Что там пишут:</b>\n${safePreview}\n\nОткрыть разбор:\n${deepLink}`,
                                { parse_mode: 'HTML', disable_web_page_preview: true }
                            );

                            await supabase
                                .from('userbot_inbox_notifications')
                                .insert({
                                    owner_id: ownerId,
                                    userbot_id: userbot.id,
                                    dialog_tg_user_id: dialogTgUserId,
                                    last_message_id: lastMessageId,
                                    preview_text: preview || null,
                                    unread_count: unreadCount,
                                    notified_at: new Date().toISOString()
                                });
                        }
                    } catch (error) {
                        console.error(`Ошибка userbot inbox watch для ${userbot.id}:`, error.message);
                    } finally {
                        if (client) {
                            try { await client.disconnect(); } catch {}
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка cron userbot inbox watch:', error.message);
        }
    }, 3 * 60 * 1000);
};
