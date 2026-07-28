// Robokassa service integration removed

export const NORMAL_PLAN = {
    code: 'normal_365d',
    title: 'Bullgram Normal',
    amountRub: Number(process.env.BILLING_NORMAL_PRICE_RUB || 900),
    durationDays: Number(process.env.BILLING_NORMAL_DURATION_DAYS || 365)
};

function minutes(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function addDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
}

function sanitizeOrder(order) {
    if (!order) return null;
    return {
        id: order.id,
        plan_code: order.plan_code,
        status: order.status,
        amount_rub: Number(order.amount_rub || 0),
        currency: order.currency,
        duration_days: order.duration_days,
        provider: order.provider,
        provider_invoice_id: order.provider_invoice_id,
        payment_url: order.payment_url,
        paid_at: order.paid_at,
        expires_at: order.expires_at,
        created_at: order.created_at,
        updated_at: order.updated_at
    };
}

function sanitizeProfile(profile) {
    if (!profile) return null;
    return {
        product_tier: profile.product_tier || 'trial',
        trial_started_at: profile.trial_started_at || null,
        trial_ends_at: profile.trial_ends_at || null,
        normal_started_at: profile.normal_started_at || null,
        normal_ends_at: profile.normal_ends_at || null
    };
}

export function getBillingReadiness() {
    return {
        robokassa: {
            enabled: false,
            configured: false,
            test_mode: false
        }
    };
}

export async function downgradeExpiredNormal(supabase, ownerId = null) {
    const nowIso = new Date().toISOString();
    let query = supabase
        .from('profiles')
        .update({
            product_tier: 'trial'
        })
        .eq('product_tier', 'normal')
        .lt('normal_ends_at', nowIso);

    if (ownerId) query = query.eq('id', ownerId);
    const { error } = await query;
    if (error && !String(error.message || '').includes('normal_ends_at')) {
        throw error;
    }
}

async function expireStaleOrders(supabase, ownerId = null) {
    const nowIso = new Date().toISOString();
    let query = supabase
        .from('billing_orders')
        .update({
            status: 'expired',
            updated_at: nowIso
        })
        .eq('status', 'pending')
        .lt('expires_at', nowIso);

    if (ownerId) query = query.eq('owner_id', ownerId);
    const { error } = await query;
    if (error && !String(error.message || '').includes('billing_orders')) {
        throw error;
    }
}

async function loadProfile(supabase, ownerId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('product_tier, trial_started_at, trial_ends_at, normal_started_at, normal_ends_at')
        .eq('id', ownerId)
        .maybeSingle();
    if (error) throw error;
    return data || {
        product_tier: 'trial',
        trial_started_at: null,
        trial_ends_at: null,
        normal_started_at: null,
        normal_ends_at: null
    };
}

export async function getCurrentBillingState(supabase, ownerId) {
    await downgradeExpiredNormal(supabase, ownerId);
    await expireStaleOrders(supabase, ownerId);

    const [profileResult, orderResult] = await Promise.all([
        loadProfile(supabase, ownerId),
        supabase
            .from('billing_orders')
            .select('*')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
    ]);

    if (orderResult.error) throw orderResult.error;

    return {
        plan: NORMAL_PLAN,
        readiness: getBillingReadiness(),
        profile: sanitizeProfile(profileResult),
        order: sanitizeOrder(orderResult.data)
    };
}

export async function createNormalCheckoutOrder(supabase, ownerId) {
    const error = new Error('Онлайн-оплата тарифа временно недоступна. Пожалуйста, обратитесь в поддержку для активации тарифа Normal.');
    error.statusCode = 503;
    throw error;
}

export async function recordBillingEvent(supabase, event) {
    const { error } = await supabase
        .from('billing_events')
        .insert({
            billing_order_id: event.billing_order_id || null,
            owner_id: event.owner_id || null,
            event_type: event.event_type,
            provider: event.provider || 'robokassa',
            provider_invoice_id: event.provider_invoice_id || null,
            amount_rub: event.amount_rub ?? null,
            signature_valid: event.signature_valid ?? null,
            payload: event.payload || {}
        });
    if (error && !String(error.message || '').includes('billing_events')) {
        throw error;
    }
}

export async function activateNormalForOrder(supabase, order) {
    if (!order?.owner_id) return null;

    const profile = await loadProfile(supabase, order.owner_id);
    if (String(profile.product_tier || '').toLowerCase() === 'pro') {
        return sanitizeProfile(profile);
    }

    const now = new Date();
    const currentEnd = profile.normal_ends_at ? new Date(profile.normal_ends_at) : null;
    const baseDate = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
    const normalEndsAt = addDays(baseDate, order.duration_days || NORMAL_PLAN.durationDays).toISOString();

    const { data, error } = await supabase
        .from('profiles')
        .update({
            product_tier: 'normal',
            trial_started_at: null,
            trial_ends_at: null,
            normal_started_at: now.toISOString(),
            normal_ends_at: normalEndsAt
        })
        .eq('id', order.owner_id)
        .select('product_tier, trial_started_at, trial_ends_at, normal_started_at, normal_ends_at')
        .single();

    if (error) throw error;
    return sanitizeProfile(data);
}
// Robokassa result and load helpers removed
