/**
 * Timezone helpers для автопостера.
 * Все функции чистые — без состояния, без сайд-эффектов.
 */

export function getTzOffset(date, timeZone) {
    try {
        const tzString = date.toLocaleString('en-US', { timeZone, timeZoneName: 'longOffset' });
        const offsetMatch = tzString.match(/GMT([+-]\d+)(?::(\d+))?/);
        if (!offsetMatch) return 0;
        const hours = parseInt(offsetMatch[1], 10);
        const minutes = parseInt(offsetMatch[2] || '0', 10);
        const totalMinutes = hours * 60 + (hours >= 0 ? minutes : -minutes);
        return totalMinutes * 60 * 1000;
    } catch (e) {
        return 3 * 60 * 60 * 1000; // Europe/Moscow (+3) default fallback
    }
}

export function getUtcDateForLocal(year, month, day, hour, minute, timeZone) {
    const utcDate = new Date(Date.UTC(year, month, day, hour, minute));
    const offsetMs = getTzOffset(utcDate, timeZone);
    return new Date(utcDate.getTime() - offsetMs);
}

export function getLocalDateParts(date, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        }).formatToParts(date);
        return {
            year: Number(parts.find(p => p.type === 'year').value),
            month: Number(parts.find(p => p.type === 'month').value) - 1,
            day: Number(parts.find(p => p.type === 'day').value)
        };
    } catch (e) {
        return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth(),
            day: date.getUTCDate()
        };
    }
}

/**
 * Возвращает [start, end) месяца в указанной таймзоне как ISO-строки UTC.
 * month — 1-based (1 = January), чтобы совпадать с человеческим "июнь = 6".
 *
 * Используется компилятором best-of для фильтра posted_at по местному месяцу канала
 * (Europe/Moscow, Asia/Vladivostok и т.д.) вместо голого UTC.
 */
export function monthBoundsInTz(year, month, timeZone) {
    const tz = timeZone || 'UTC';
    const startUtc = getUtcDateForLocal(year, month - 1, 1, 0, 0, tz);
    const endUtc = getUtcDateForLocal(year, month, 1, 0, 0, tz);
    return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

/**
 * Классифицирует posted_at (ISO) в 'YYYY-MM' по указанной таймзоне.
 * Используется календарём best-of для группировки постов по месяцам канала.
 *
 * Возвращает 'YYYY-MM' (например '2026-06') или null при невалидной дате/таймзоне.
 */
export function classifyMonthInTz(postedAtIso, timeZone) {
    try {
        if (postedAtIso === null || postedAtIso === undefined) return null;
        const date = new Date(postedAtIso);
        if (isNaN(date.getTime())) return null;
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone || 'UTC',
            year: 'numeric',
            month: '2-digit'
        }).formatToParts(date);
        const y = parts.find(p => p.type === 'year')?.value;
        const m = parts.find(p => p.type === 'month')?.value;
        if (!y || !m) return null;
        return `${y}-${m}`;
    } catch (e) {
        return null;
    }
}
