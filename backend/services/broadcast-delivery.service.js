// Общая логика доставки рассылок. Единственный источник для:
// - валидации POST /api/broadcast/send (матрица подготовки фильтрует аудиторию);
// - крон-джобы backend/jobs/broadcast-delivery.job.js (отправка одному получателю).
// До этого вся логика доставки жила в теле HTTP-хэндлера /send — из-за этого
// массовая отправка умирала вместе с сокетом.
import { classifyTelegramError } from '../utils/telegram-error-events.js';

export function senderTypeUsesUserbot(senderType = '') {
    return [
        'userbot_only',
        'official_then_userbot',
        'userbot_pool_round_robin',
        'official_then_userbot_pool'
    ].includes(String(senderType || '').trim());
}

function senderTypeUsesUserbotPool(senderType = '') {
    return [
        'userbot_pool_round_robin',
        'official_then_userbot_pool'
    ].includes(String(senderType || '').trim());
}

export async function loadPreparationMatrix(supabase, ownerId, preparationId) {
    const { data: preparation } = await supabase
        .from('broadcast_preparations')
        .select('id, status, userbot_ids')
        .eq('id', preparationId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (!preparation) throw new Error('Подготовка не найдена');
    if (preparation.status !== 'ready') throw new Error('Подготовка еще не завершена — дождись статуса «готово»');

    const items = [];
    let from = 0;
    while (true) {
        const { data } = await supabase
            .from('broadcast_preparation_items')
            .select('tg_user_id, reachable_by')
            .eq('preparation_id', preparationId)
            .range(from, from + 999)
            .order('id', { ascending: true });
        if (!data || data.length === 0) break;
        items.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    const matrix = new Map();
    for (const item of items) {
        const touchpoints = Array.isArray(item.reachable_by) ? item.reachable_by : [];
        touchpoints.sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
        matrix.set(String(item.tg_user_id), touchpoints);
    }
    return matrix;
}

/**
 * Фабрика отправителя рассылки: официальный бот -> фолбэк/пул юзерботов,
 * с приоритетом touchpoint'а из матрицы подготовки. Наружу не бросает —
 * возвращает честный исход одной доставки.
 */
export function createBroadcastDeliverySender({ userbotService, getBotById }) {
    async function sendViaUserbotPool(userbots, startIndex, tgUserId, messageText, options = {}) {
        if (!userbots || userbots.length === 0) {
            throw new Error('Нет доступных юзерботов для отправки');
        }

        let lastError = null;

        for (let offset = 0; offset < userbots.length; offset++) {
            const userbot = userbots[(startIndex + offset) % userbots.length];

            try {
                await userbotService.sendMessage(userbot, tgUserId, messageText, {
                    event_source: 'broadcast',
                    event_type: 'broadcast_delivery',
                    ...options
                });
                return userbot;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Ни один юзербот из пула не смог доставить сообщение');
    }

    async function deliverToRecipient({ campaignId, messageText, senderType, selectedUserbots, preparationMatrix, row, index }) {
        const selectedUserbot = selectedUserbots[0] || null;
        const bot = row.bot_id ? getBotById(row.bot_id) : null;
        let deliveryStatus = 'failed';
        let errorText = null;
        let deliveredAt = null;
        let actualSenderUserbot = null;
        let sentViaUserbot = false;
        let blockedByUser = false;
        const canUseOfficialBot = senderType === 'official_only' ||
            senderType === 'official_then_userbot' ||
            senderType === 'official_then_userbot_pool';
        const canFallbackToUserbot = senderType === 'official_then_userbot' ||
            senderType === 'official_then_userbot_pool';
        const canUseOnlyUserbot = senderType === 'userbot_only' ||
            senderType === 'userbot_pool_round_robin';

        try {
            if (canUseOfficialBot && bot) {
                await bot.telegram.sendMessage(row.tg_user_id, messageText, { parse_mode: 'Markdown' });
                deliveryStatus = 'sent';
                deliveredAt = new Date().toISOString();
            } else {
                throw new Error(
                    canUseOnlyUserbot
                        ? 'Выбран режим отправки только юзерботами'
                        : 'Официальный бот недоступен'
                );
            }
        } catch (botError) {
            try {
                if (!canFallbackToUserbot && !canUseOnlyUserbot) {
                    throw botError;
                }
                if (selectedUserbots.length === 0) throw botError;

                let pool = senderTypeUsesUserbotPool(senderType)
                    ? [...selectedUserbots]
                    : [selectedUserbot].filter(Boolean);
                let startIndex = senderTypeUsesUserbotPool(senderType) ? index % selectedUserbots.length : 0;
                let commonChatId = null;

                if (preparationMatrix) {
                    const touchpoints = preparationMatrix.get(String(row.tg_user_id)) || [];
                    const selectedIds = new Set(selectedUserbots.map(userbot => String(userbot.id)));
                    const preferred = touchpoints.find(tp => selectedIds.has(String(tp.userbot_id)));
                    if (preferred) {
                        const preferredUserbot = selectedUserbots.find(userbot => String(userbot.id) === String(preferred.userbot_id));
                        if (preferredUserbot) {
                            pool = [preferredUserbot, ...pool.filter(userbot => String(userbot.id) !== String(preferred.userbot_id))];
                            startIndex = 0;
                        }
                        if (preferred.via === 'shared_chat' && preferred.chat_id) {
                            commonChatId = preferred.chat_id;
                        }
                    }
                }

                actualSenderUserbot = await sendViaUserbotPool(
                    pool,
                    startIndex,
                    row.tg_user_id,
                    messageText,
                    {
                        campaign_id: campaignId,
                        channel_id: row.channel_id || null,
                        ...(commonChatId ? { common_chat_id: commonChatId } : {})
                    }
                );
                deliveryStatus = 'sent';
                deliveredAt = new Date().toISOString();
                sentViaUserbot = true;
            } catch (userbotError) {
                deliveryStatus = 'failed';
                errorText = userbotError.message || botError.message || 'Не удалось доставить сообщение';
                const classification = classifyTelegramError(userbotError);
                if (['privacy_restricted', 'user_blocked', 'peer_invalid'].includes(classification.restriction_kind)) {
                    blockedByUser = true;
                }
            }
        }

        return { deliveryStatus, errorText, deliveredAt, actualSenderUserbot, sentViaUserbot, blockedByUser };
    }

    return { deliverToRecipient };
}
