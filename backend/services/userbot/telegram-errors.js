// Leaf-модуль userbot.service.js (стадия 1 разрезки, план §7.3b):
// классификация Telegram-ошибок и детали health-check'ов. Код перенесён
// дословно; leaf не импортирует фасад.
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { logTelegramErrorEvent } from '../../utils/telegram-error-events.js';

export function isTimeoutLikeTelegramError(error) {
    const raw = String(
        error?.errorMessage
        || error?.message
        || error?.description
        || error
        || ''
    ).toUpperCase();

    return raw.includes('TIMEOUT')
        || raw.includes('TIMED OUT')
        || raw.includes('ETIMEDOUT')
        || raw.includes('TIMEOUTERROR')
        || raw.includes('CONNECTION')
        || raw.includes('SOCKS')
        || raw.includes('NETWORK');
}

export function describeTelegramError(error) {
    return {
        message: String(error?.errorMessage || error?.message || error?.description || error || '').trim() || null,
        code: error?.code || null,
        name: error?.name || null
    };
}

export function detectSpamBlockReason(messages = []) {
    const texts = (messages || [])
        .filter((message) => !message?.out)
        .map((message) => String(message?.message || '').trim())
        .filter(Boolean);

    for (const text of texts) {
        const normalized = text.toLowerCase();
        if (
            normalized.includes('your account was blocked')
            || normalized.includes('violations of the telegram terms of service')
            || normalized.includes('confirmed by our moderators')
            || normalized.includes('spam')
            || normalized.includes('your account is free as a bird')
            || normalized.includes('good news, no limits are currently applied')
        ) {
            return text;
        }
    }

    return '';
}

export function buildHealthDetails({
    session = 'unknown',
    restriction = 'unknown',
    restrictionReason = '',
    spambotState = 'not_checked',
    spambotReason = '',
    spambotSource = ''
} = {}) {
    return {
        session,
        restriction,
        restriction_reason: restrictionReason || '',
        spambot: {
            state: spambotState,
            reason: spambotReason || '',
            source: spambotSource || ''
        }
    };
}

export async function wrapTelegramError(supabase, userbot, error, operationName) {
    if (error instanceof MCPError) return error;
    let eventId = null;
    try {
        const recorded = await logTelegramErrorEvent(supabase, {
            userbot_id: userbot?.id,
            owner_id: userbot?.owner_id,
            event_type: 'external_tool_error',
            error_code: String(error?.errorMessage || error?.code || '').slice(0, 100) || null,
            error_message: String(error?.message || error || '').slice(0, 1000),
            source: operationName
        });
        eventId = recorded?.id || null;
    } catch (logErr) {
        console.error(`[UserbotService] ${operationName}: failed to log Telegram error:`, logErr.message);
    }
    const secondsMatch = String(error?.message || '').match(/(\d+)\s*(?:seconds|секунд)/i);
    const retryAfterSec = secondsMatch ? Number(secondsMatch[1]) : null;
    return new MCPError(
        ERROR_CODES.TELEGRAM_ERROR,
        `Telegram error in ${operationName}: ${error?.errorMessage || error?.message || 'unknown'}`,
        {
            auditStatus: 'telegram_error',
            telegramErrorEventId: eventId,
            retryAfterSec,
            details: { operation: operationName, event_id: eventId }
        }
    );
}
