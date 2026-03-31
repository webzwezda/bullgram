function trimText(value, maxLength = 500) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function classifyTelegramError(errorOrMessage = '') {
    const raw = String(
        errorOrMessage?.errorMessage
        || errorOrMessage?.message
        || errorOrMessage?.description
        || errorOrMessage
        || ''
    ).trim();
    const normalized = raw.toUpperCase();

    const base = {
        raw_message: raw || null,
        error_code: trimText(errorOrMessage?.code || errorOrMessage?.name || null, 120),
        restriction_kind: 'unknown',
        severity: 'warning',
        is_restriction: false
    };

    if (!normalized) {
        return {
            ...base,
            restriction_kind: 'unknown'
        };
    }

    if (normalized.includes('FLOOD_WAIT')) {
        return { ...base, restriction_kind: 'flood_wait', severity: 'warning', is_restriction: true };
    }
    if (normalized.includes('AUTH_KEY_UNREGISTERED') || normalized.includes('SESSION_REVOKED')) {
        return { ...base, restriction_kind: 'session_revoked', severity: 'danger', is_restriction: true };
    }
    if (normalized.includes('USER_PRIVACY_RESTRICTED')) {
        return { ...base, restriction_kind: 'privacy_restricted', severity: 'warning', is_restriction: true };
    }
    if (normalized.includes('USER_IS_BLOCKED')) {
        return { ...base, restriction_kind: 'user_blocked', severity: 'warning', is_restriction: true };
    }
    if (normalized.includes('CHAT_WRITE_FORBIDDEN')) {
        return { ...base, restriction_kind: 'chat_write_forbidden', severity: 'warning', is_restriction: true };
    }
    if (
        normalized.includes('YOUR ACCOUNT WAS BLOCKED')
        || normalized.includes('VIOLATIONS OF THE TELEGRAM TERMS OF SERVICE')
        || normalized.includes('CONFIRMED BY OUR MODERATORS')
    ) {
        return { ...base, restriction_kind: 'account_flagged', severity: 'danger', is_restriction: true };
    }
    if (
        normalized.includes('PEER_ID_INVALID')
        || normalized.includes('INPUT ENTITY')
        || normalized.includes('CANNOT FIND ANY ENTITY')
        || normalized.includes('NO INPUT ENTITY')
    ) {
        return { ...base, restriction_kind: 'peer_invalid', severity: 'warning', is_restriction: false };
    }
    if (normalized.includes('ACCOUNT_RESTRICTED') || normalized.includes('RESTRICTED')) {
        return { ...base, restriction_kind: 'account_restricted', severity: 'danger', is_restriction: true };
    }
    if (normalized.includes('SCAM') || normalized.includes('FAKE')) {
        return { ...base, restriction_kind: 'account_flagged', severity: 'danger', is_restriction: true };
    }
    if (normalized.includes('TIMEOUT')) {
        return { ...base, restriction_kind: 'timeout', severity: 'warning', is_restriction: false };
    }

    return base;
}

export async function logTelegramErrorEvent(supabase, payload = {}) {
    if (!supabase || !payload?.owner_id) return;

    const classification = classifyTelegramError(payload.error);
    const insertPayload = {
        owner_id: payload.owner_id,
        userbot_id: payload.userbot_id || null,
        account_id: payload.account_id || payload.userbot_id || null,
        channel_id: payload.channel_id || null,
        subscription_id: payload.subscription_id || null,
        campaign_id: payload.campaign_id || null,
        tg_user_id: payload.tg_user_id ? String(payload.tg_user_id) : null,
        event_source: trimText(payload.event_source || 'telegram', 80) || 'telegram',
        event_type: trimText(payload.event_type || 'unknown', 80) || 'unknown',
        severity: trimText(payload.severity || classification.severity || 'warning', 16) || 'warning',
        restriction_kind: trimText(payload.restriction_kind || classification.restriction_kind || 'unknown', 80) || 'unknown',
        is_restriction: payload.is_restriction === true || classification.is_restriction === true,
        error_code: trimText(payload.error_code || classification.error_code, 120),
        error_message: trimText(payload.error_message || classification.raw_message || payload.error?.message || payload.error, 1000),
        happened_at: payload.happened_at || new Date().toISOString(),
        meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {}
    };

    try {
        await supabase.from('telegram_error_events').insert(insertPayload);
    } catch (error) {
        console.error('[TelegramErrorEvents] insert failed:', error?.message || error);
    }
}
