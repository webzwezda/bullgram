// Логирование событий бота (access_events / payment_events / customer_funnel_events) —
// вынесено дословно из official-bot.service.js; this.supabase -> параметр supabase.

export async function logAccessEvent(supabase, {
    ownerId,
    channelId = null,
    inviteId = null,
    subscriptionId = null,
    invoiceId = null,
    tgUserId,
    eventType,
    eventSource = 'system',
    payload = {}
}) {
    if (!ownerId || !tgUserId || !eventType) return;

    await supabase.from('access_events').insert({
        owner_id: ownerId,
        channel_id: channelId,
        invite_id: inviteId,
        subscription_id: subscriptionId,
        invoice_id: invoiceId,
        tg_user_id: String(tgUserId),
        event_type: eventType,
        event_source: eventSource,
        payload
    });
}

export async function logPaymentEvent(supabase, {
    ownerId,
    invoiceId,
    provider = 'system',
    externalPaymentId = null,
    eventType,
    status = null,
    payload = {}
}) {
    if (!ownerId || !invoiceId || !eventType) return;

    try {
        await supabase.from('payment_events').insert({
            owner_id: ownerId,
            invoice_id: invoiceId,
            provider,
            external_payment_id: externalPaymentId,
            event_type: eventType,
            status,
            payload
        });
    } catch (error) {
        if ((error.message || '').includes('payment_events')) return;
        console.error('Ошибка payment_events:', error.message);
    }
}

export async function logCustomerFunnelEvent(supabase, {
    ownerId,
    botId = null,
    tgUserId,
    tariffId = null,
    eventType,
    source = 'official_bot',
    referralCode = null,
    sessionKey = null,
    payload = {}
}) {
    if (!ownerId || !tgUserId || !eventType) return;

    try {
        await supabase
            .from('customer_funnel_events')
            .insert({
                owner_id: ownerId,
                bot_id: botId,
                tg_user_id: String(tgUserId),
                tariff_id: tariffId,
                event_type: eventType,
                source,
                referral_code: referralCode,
                session_key: sessionKey,
                payload
            });
    } catch (error) {
        if ((error.message || '').includes('customer_funnel_events')) return;
        if ((error.message || '').includes('duplicate key')) return;
        console.error('Ошибка customer_funnel_events:', error.message);
    }
}

export function buildCustomerFunnelSessionKey({ botId = null, tgUserId, eventType, tariffId = null }) {
    const day = new Date().toISOString().slice(0, 10);
    return [botId || 'bot', tgUserId || 'user', eventType || 'event', tariffId || 'list', day].join(':');
}
