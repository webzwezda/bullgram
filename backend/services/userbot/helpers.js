// Leaf-модуль userbot.service.js (стадия 1 разрезки, план §7.3b):
// чистые хелперы волн userbot-ops (нормализация аргументов, дисконнект,
// типы диалогов, даты). Код перенесён дословно; leaf не импортирует фасад.
import crypto from 'crypto';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';

export function clampLimit(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

export function normalizeChatIdInput(value) {
    if (value == null) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
    }
    const str = String(value).trim();
    if (!/^-?\d+$/.test(str)) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, `chat_id "${str}" is not a valid Telegram chat ID.`, {});
    }
    return str;
}

// Волна 2 userbot-ops: id сообщения — положительное целое (GramJS ждёт int).
export function normalizeMessageIdInput(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, `message_id "${value}" is not a valid Telegram message ID.`, {});
    }
    return n;
}

// Положительный 63-битный long для randomId в messages.ForwardMessages.
export function randomPositiveLong() {
    return BigInt(`0x${crypto.randomBytes(8).toString('hex')}`) >> 1n;
}

export async function safeDisconnect(client) {
    if (!client) return;
    try {
        await withTimeout(client.disconnect(), 5_000, 'client.disconnect');
    } catch (e) {
        console.error('[UserbotService] disconnect failed:', e.message);
    }
}

export function matchesDialogType(dialog, type) {
    if (!type) return true;
    return dialog.kind === type;
}

export function normalizeTelegramDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') {
        const date = new Date(value * 1000);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
