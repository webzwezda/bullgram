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
