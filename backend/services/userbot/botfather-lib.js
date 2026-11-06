// Leaf-модуль userbot.service.js (стадия 1 разрезки, план §7.3b):
// библиотека BotFather-диалога и общие гарды юзербот-операций.
// Единственный экземпляр in-flight Map для botFatherCreateBot живёт здесь —
// метод botFatherCreateBot фасада импортирует её отсюда.
// Код перенесён дословно; leaf не импортирует фасад.
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { BOTFATHER_MENU_SIGNATURE, BOTFATHER_STEP_TIMEOUT_MS } from './constants.js';

// Флаги-kill-switch для опасных операций (дефолт false — доктрина userbot-флагов).
export function assertFeatureEnabled(envName, featureLabel) {
    const enabled = String(process.env[envName] || '').trim().toLowerCase() === 'true';
    if (!enabled) {
        throw new MCPError(
            ERROR_CODES.TOOL_DISABLED,
            `${featureLabel}: операция выключена на этом сервере. Включи ${envName} в .env (true) и перезапусти backend.`,
            {}
        );
    }
}

/**
 * Отказ BotFather, после которого диалог бессмысленно продолжать:
 * лимит 20 ботов на аккаунт, прочие «Sorry, you can't …».
 * Возвращаем короткую причину для INVALID_PARAMS или null.
 */
export function isBotFatherRefusal(rawValue = '') {
    const text = String(rawValue || '');
    const limitMatch = text.match(/you can't add more than (\d+) bots/i);
    if (limitMatch) {
        return `Лимит Telegram: у аккаунта уже ${limitMatch[1]} ботов — удалите или передайте одного из них (/mybots → /deletebot), затем повторите.`;
    }
    if (/^Sorry, you can't/i.test(text.trim())) {
        return text.slice(0, 200);
    }
    return null;
}


/**
 * Приветствие-меню, которое BotFather досылает при первом контакте.
 * Может приехать ПОСЛЕ нашего /newbot и перехватить окно ответа,
 * поэтому waitForBotFatherReply его отфильтровывает.
 */
export function isBotFatherGreeting(rawValue = '') {
    const text = String(rawValue || '');
    if (!text) return false;
    if (text.includes(BOTFATHER_MENU_SIGNATURE)) return true;
    // Командное меню нового диалога: перечисление /newbot + /mybots.
    return text.includes('/newbot') && text.includes('/mybots');
}

/**
 * Резолв peer пагинацией по диалогам. Свежая сессия юзербота имеет пустой
 * кэш сущностей GramJS — getInputEntity падает («Could not find the input
 * entity»). Итерация по диалогам и находит peer, и заселяет кэш сессии
 * для последующих вызовов. Кап — 10 страниц по 100 диалогов.
 */
export async function findPeerByDialogPages(client, normalizedId, { maxTotal = 600, normalize } = {}) {
    const target = String(normalizedId || '').trim();
    if (!target) return null;
    let offsetId;
    let seen = 0;
    for (let page = 0; page < 10; page++) {
        const dialogs = await client.getDialogs({ limit: 100, ...(offsetId ? { offsetId } : {}) });
        if (!dialogs?.length) return null;
        for (const dialog of dialogs) {
            seen++;
            if (String(dialog?.entity?.id || '') === target) {
                return normalize ? await normalize(dialog) : dialog.entity;
            }
        }
        const last = dialogs[dialogs.length - 1];
        const lastId = Number(last?.id || 0);
        if (!lastId || (offsetId !== undefined && lastId >= offsetId) || seen >= maxTotal) return null;
        offsetId = lastId;
    }
    return null;
}

export function parseBotFatherToken(rawValue = '') {    const match = String(rawValue || '').match(/(\d{6,10}:[A-Za-z0-9_-]{30,})/);
    return match ? match[1] : null;
}

// Ин-флайт-гард botFatherCreateBot: параллельный вызов на одном юзерботе путает
// baseline и ответы шагов — второй запуск отклоняем, пока первый не дойдёт до finally.
export const botFatherCreateBotInFlight = new Map();

function botFatherSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Поллинг DM-диалога с BotFather: ждём ВХОДЯЩЕЕ сообщение с id > afterId (в GramJS
// custom Message нет поля incoming — входящие опознаём по флагу out === false,
// свои исходящие не берём). Таймаут шага — TELEGRAM_ERROR.
export async function waitForBotFatherReply(client, peer, afterId, timeoutMs, label) {
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : BOTFATHER_STEP_TIMEOUT_MS;
    const interval = Math.min(1500, Math.max(50, Math.floor(timeout / 4)));
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        await botFatherSleep(interval);
        const messages = await withTimeout(
            client.getMessages(peer, { limit: 5 }),
            30_000,
            `${label}.poll`
        );
        const fresh = (messages || []).find(m => m?.out === false
            && Number(m?.id || 0) > afterId
            && !isBotFatherGreeting(m?.message));
        if (fresh) {
            return String(fresh?.message || '').trim();
        }
    }

    throw new MCPError(
        ERROR_CODES.TELEGRAM_ERROR,
        'BotFather не ответил вовремя — повтори операцию чуть позже.',
        { auditStatus: 'telegram_error' }
    );
}

export function parseTelegramInviteLink(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    const stripped = value
        .replace(/^@/, '')
        .replace(/^(https?:\/\/)?t\.me\//i, '')
        .replace(/^(https?:\/\/)?telegram\.me\//i, '')
        .replace(/\/+$/, '')
        .trim();

    const plusMatch = value.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i)
        || value.match(/^@(?:joinchat)\+(.+)$/i);
    if (plusMatch) {
        return { kind: 'invite_hash', value: plusMatch[1] };
    }

    const joinchatMatch = value.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
    if (joinchatMatch) {
        return { kind: 'invite_hash', value: joinchatMatch[1] };
    }

    const sMatch = value.match(/(?:https?:\/\/)?t\.me\/s\/([A-Za-z0-9_]{5,})/i);
    if (sMatch) {
        return { kind: 'username', value: sMatch[1] };
    }

    const privatePermalinkMatch = value.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)/i);
    if (privatePermalinkMatch) {
        return { kind: 'private_permalink', value: privatePermalinkMatch[1] };
    }

    const usernameFromUrlMatch = value.match(/(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,})\/?$/i);
    if (usernameFromUrlMatch) {
        return { kind: 'username', value: usernameFromUrlMatch[1] };
    }

    if (!/\s/.test(value) && /^[A-Za-z][A-Za-z0-9_]{4,}$/.test(stripped)) {
        return { kind: 'username', value: stripped };
    }

    return null;
}

export function assertUserbotOperatable(userbot) {
    if (!userbot?.id) {
        throw new MCPError(ERROR_CODES.NOT_FOUND, 'Userbot not found.', {});
    }
    if (userbot.account_type && userbot.account_type !== 'userbot') {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, `Account ${userbot.id} is not a userbot.`, {});
    }
    if (userbot.runtime_status === 'pending_activation') {
        throw new MCPError(
            ERROR_CODES.SAFE_MODE_BLOCKED,
            `Userbot ${userbot.id} is in safe-mode (pending_activation). Activate it at /userbot/accounts first.`,
            {}
        );
    }
    if (userbot.runtime_status === 'restricted') {
        throw new MCPError(
            ERROR_CODES.ACCOUNT_RESTRICTED,
            `Userbot ${userbot.id} is restricted by Telegram.`,
            {}
        );
    }
}
