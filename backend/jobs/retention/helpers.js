/**
 * Пул и маркировка для джобы retention-напоминаний — вынесены из retention.job.js
 * без изменения поведения (разрезка под pre-commit лимит 20KB). supabase передаётся
 * первым аргументом. env-флаг USERBOT_RETENTION_DM_ENABLED читается в главном job-файле.
 */
import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import { isActorEligible } from '../../services/messaging-router.service.js';

function isOperationalUserbot(account) {
    return String(account?.runtime_status || '').trim().toLowerCase() !== 'pending_activation';
}

export async function loadContourPool(supabase, ownerId, botId) {
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

// Пул ретеншн-фолбэка: контурные акторы бота; пусто — последний рабочий юзербот пулом из одного
export async function loadRetentionPool(supabase, ownerId, botId) {
    if (botId) {
        try {
            const contourPool = await loadContourPool(supabase, ownerId, botId);
            if (contourPool.length > 0) return contourPool;
        } catch (poolErr) {
            console.error('[Напоминание] Не собрали контурный пул, падаем на последний юзербот:', poolErr?.message || poolErr);
        }
    }
    const latest = await loadLatestUserbot(supabase, ownerId);
    return latest ? [latest] : [];
}

export async function loadLatestUserbot(supabase, ownerId) {
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

// Политика маркировки: last_reminder_sent_at ставится только по финальному исходу — доставлено ботом/юзерботом или дефинитивный скип; транзиентные ошибки не маркируем, чтобы следующий тик повторил попытку
export async function markReminderSent(supabase, subscriptionId) {
    const { error } = await supabase
        .from('subscriptions')
        .update({ last_reminder_sent_at: new Date().toISOString() })
        .eq('id', subscriptionId);
    if (error) {
        // Не промаркировали — следующий тик отправит повторно, поэтому сбой должен быть виден в логах
        console.error('[Напоминание] Не поставили last_reminder_sent_at:', error.message);
    }
}

export async function logReminderEvent(supabase, sub, ownerId, botId, payload) {
    try {
        await supabase.from('access_events').insert({
            owner_id: ownerId,
            channel_id: sub.channel_id || null,
            subscription_id: sub.id,
            tg_user_id: String(sub.tg_user_id),
            event_source: 'retention',
            event_type: 'retention_reminder',
            payload
        });
    } catch (logErr) {
        console.error('[Напоминание] Не записали access_event:', logErr?.message || logErr);
    }
}
