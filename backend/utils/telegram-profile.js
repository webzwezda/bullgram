// Общие хелперы профиля Telegram-аккаунта: патч из getMe() и сводка здоровья.
// Используются и роутами (userbot.routes.js), и фоновыми джобами
// (intake-resting.job.js) — одно место для формы данных.

export function buildTelegramProfilePatch(me, extra = {}) {
    const firstName = String(me?.firstName || '').trim() || null;
    const lastName = String(me?.lastName || '').trim() || null;
    return {
        tg_account_id: me?.id ? me.id.toString() : null,
        tg_username: me?.username || firstName || null,
        tg_first_name: firstName,
        tg_last_name: lastName,
        tg_phone: String(me?.phone || '').trim() || null,
        ...extra
    };
}

// Правила Telegram для юзернейма пользователя: 5–32 символа, латиница/цифры/_
// и первый символ — буква. Ведущие @ допускаем на входе и срезаем.
export const TG_USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

// null = не подходит (текст ошибки кладёт вызывающий роут), строка = норм.
export function normalizeTelegramUsernameInput(raw) {
    const cleaned = String(raw || '').trim().replace(/^@+/, '');
    return TG_USERNAME_PATTERN.test(cleaned) ? cleaned : null;
}

// Единая форма health_summary в tg_accounts: что показываем в карточке
// аккаунта и «отстойнике». Наполняется из результата inspectAccountHealth
// ({ status, reason, details }). 2026-11-15: + spambot_reason/source/checked_at
// (план docs/plans/2026-11-15-spambot-verdicts-appeals.md) — вердикт SpamBot
// персистится, липкость limited и MCP-сигнал читают отсюда.
export function buildHealthSummary(health, checkedAt = new Date().toISOString()) {
    const details = health?.details || null;
    const spambotState = String(details?.spambot?.state || 'not_checked');
    const definitiveSpambot = ['clear', 'limited', 'blocked'].includes(spambotState);
    return {
        status: String(health?.status || 'error'),
        spambot_state: spambotState,
        spambot_reason: definitiveSpambot ? String(details?.spambot?.reason || '').slice(0, 500) : '',
        spambot_source: details?.spambot?.source || '',
        spambot_checked_at: definitiveSpambot ? checkedAt : null,
        restriction: details?.restriction || 'unknown',
        restriction_reason: details?.restriction_reason || health?.reason || '',
        checked_at: checkedAt
    };
}
