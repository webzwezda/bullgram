/**
 * Пул и маркировка для джобы брошенных корзин — вынесены из abandoned-cart.job.js
 * без изменения поведения (разрезка под pre-commit лимит 20KB). supabase передаётся
 * первым аргументом.
 */
import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';
import { isActorEligible } from '../../services/messaging-router.service.js';

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

// Пул дожима: контурные акторы бота; пусто — весь элигибельный пул владельца (связок могло не быть вовсе)
export async function loadAbandonedPool(supabase, ownerId, botId) {
    if (botId) {
        try {
            const contourPool = await loadContourPool(supabase, ownerId, botId);
            if (contourPool.length > 0) return contourPool;
        } catch (poolErr) {
            console.error('[Брошенная корзина] Не собрали контурный пул, берём весь пул владельца:', poolErr?.message || poolErr);
        }
    }

    const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
    const { data, error } = await supabase
        .from('tg_accounts')
        .select('*, proxies(is_working)')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot');
    if (error) throw error;

    const now = new Date();
    return (data || []).filter((account) =>
        !reservedUserbotIds.has(String(account.id)) && isActorEligible(account, { now })
    );
}

// Политика маркировки: reminded/reminded_at ставятся только по финальному исходу — доставлено ботом или дефинитивный скип; транзиентные ошибки не маркируем, чтобы следующий тик повторил попытку (сумма счёта не мутируется, ретрай безопасен)
export async function markReminded(supabase, invoiceId) {
    const { error } = await supabase
        .from('invoices')
        .update({ reminded: true, reminded_at: new Date().toISOString() })
        .eq('id', invoiceId);
    if (error) {
        // Не промаркировали — следующий тик отправит повторно, поэтому сбой должен быть виден в логах
        console.error('[Брошенная корзина] Не поставили reminded/reminded_at:', error.message);
    }
}

export async function logAbandonedEvent(supabase, invoice, ownerId, channelId, payload) {
    try {
        await supabase.from('access_events').insert({
            owner_id: ownerId,
            channel_id: channelId,
            invoice_id: invoice.id,
            tg_user_id: String(invoice.tg_user_id),
            event_source: 'abandoned',
            event_type: 'abandoned_reminder',
            payload
        });
    } catch (logErr) {
        console.error('[Брошенная корзина] Не записали access_event:', logErr?.message || logErr);
    }
}
