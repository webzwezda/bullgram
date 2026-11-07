// Платформенный алерт в админ-чат Telegram (BACKLOG §32).
//
// Адресат: TG_BOT_TOKEN + TG_ADMIN_CHAT_ID (тот же бот/чат, что и в
// scripts/restore-managed-proxies.mjs и routes/access-requests.routes.js).
// Дедуп 1ч на ключ через module-level Map: пул прокси может кончаться
// на каждом новом подключении аккаунта, админу достаточно одного письма в час.
// Контракт: НИКОГДА не бросает — вызывающий код (JIT-выдача прокси) и так
// non-fatal, алерт не должен ломать основной сценарий.
import { logger } from './logger.js';

const DEDUP_TTL_MS = 60 * 60 * 1000;

// key -> timestamp последней отправки. Ключи — короткие константы
// ('proxy_pool_exhausted', …), рост карты ограничен числом типов алертов.
const lastSentAtByKey = new Map();

export async function notifyPlatformAlert(key, text) {
    const now = Date.now();
    const lastSentAt = lastSentAtByKey.get(key) || 0;
    if (now - lastSentAt < DEDUP_TTL_MS) {
        return { sent: false, deduped: true };
    }

    // Отмечаем ДО отправки: параллельные вызовы того же ключа не удваивают алерт.
    lastSentAtByKey.set(key, now);

    const token = String(process.env.TG_BOT_TOKEN || '').trim();
    const chatId = String(process.env.TG_ADMIN_CHAT_ID || '').trim();
    if (!token || !chatId) {
        logger.warn({ module: 'platform-alert', alert_key: key }, 'platform alert skipped: TG_BOT_TOKEN/TG_ADMIN_CHAT_ID not configured');
        return { sent: false, reason: 'telegram not configured' };
    }

    const body = text || `Bullgram alert: ${key}`;
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: body }),
            signal: AbortSignal.timeout(5000)
        });
        const data = await response.json().catch(() => null);
        if (data?.ok !== true) {
            logger.error({ module: 'platform-alert', alert_key: key, description: data?.description || null }, 'platform alert rejected by Telegram');
            return { sent: false, reason: data?.description || 'telegram rejected' };
        }
        return { sent: true };
    } catch (error) {
        logger.error({ module: 'platform-alert', alert_key: key, err: error }, 'platform alert delivery failed');
        return { sent: false, reason: error?.message || 'unknown' };
    }
}

// Только для тестов: сбросить дедуп-окно между кейсами.
export function __resetPlatformAlertDedupForTests() {
    lastSentAtByKey.clear();
}
