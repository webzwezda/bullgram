// Общие хелперы доставки официальным ботом для дожимов (abandoned / browse follow-up).
// Источник: backend/jobs/retention.job.js (:22-104) — скопировано один-в-один,
// сам retention.job.js на util сознательно не переведён (свежий код, не трогаем).

// Классификация ошибки отправки ботом: parse-кандидат (400 / can't parse) ретраится plain-text'ом, блокировка — только 403 / blocked|kicked|forbidden|deactivated
export function classifyBotSendError(err) {
    const text = [err?.message, err?.description, err?.response?.description].filter(Boolean).join(' ');
    const code = Number(err?.code || err?.response?.error_code || 0);
    if (/can't parse/i.test(text)) return 'parse';
    if (code === 403 || /blocked|kicked|forbidden|deactivated/i.test(text)) return 'blocked';
    if (code === 400) return 'parse';
    return 'transient';
}

// Счищаем markdown-декор перед отправкой без parse_mode
export function stripMarkdownDecor(text) {
    return String(text || '').replace(/[*_`\[\]]/g, '');
}

// Отправка ботом: parse-ошибку Markdown ретраим тем же текстом без декора и без parse_mode, это тоже считается доставкой ботом
export async function deliverViaBot(bot, tgUserId, text, options) {
    try {
        await bot.telegram.sendMessage(tgUserId, text, options);
        return { status: 'delivered', plainUsed: false };
    } catch (err) {
        const kind = classifyBotSendError(err);
        if (kind !== 'parse') {
            return { status: kind, plainUsed: false, error: err };
        }
        const plainOptions = options.reply_markup ? { reply_markup: options.reply_markup } : {};
        try {
            await bot.telegram.sendMessage(tgUserId, stripMarkdownDecor(text), plainOptions);
            return { status: 'delivered', plainUsed: true };
        } catch (plainErr) {
            const plainKind = classifyBotSendError(plainErr);
            return {
                status: plainKind === 'blocked' ? 'blocked' : (plainKind === 'transient' ? 'transient' : 'undeliverable'),
                plainUsed: true,
                error: plainErr
            };
        }
    }
}
