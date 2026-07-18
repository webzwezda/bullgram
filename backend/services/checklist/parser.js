/**
 * Парсер произвольного текста в {title, items[]}.
 *
 * Правила:
 *   1. Если первая строка заканчивается на ':' — это title, остальные строки — items.
 *   2. Иначе: title='Чеклист', все строки — items.
 *   3. Split по '\n', если их >1. Иначе по ',' или '•'.
 *   4. Убираем буллеты ('-', '•', '*', '·', '–', '—') и нумерацию ('1.', '1)').
 *
 * Используется во ВСЕХ источниках: DM, mention, /todo command, web-форма, webhook.
 */

const DEFAULT_TITLE = 'Чеклист';

const BULLET_RE = /^[-•*·–—]\s*/;
const NUMERIC_RE = /^\d+[.)]\s*/;

function stripItem(line) {
    return line
        .trim()
        .replace(BULLET_RE, '')
        .replace(NUMERIC_RE, '')
        .trim();
}

export function parseTextToItems(rawText) {
    const stripped = String(rawText || '').trim();
    if (!stripped) return { title: DEFAULT_TITLE, items: [] };

    const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean);

    let title = DEFAULT_TITLE;
    let body = stripped;

    if (lines.length > 1 && lines[0].endsWith(':')) {
        title = lines[0].slice(0, -1).trim() || DEFAULT_TITLE;
        body = lines.slice(1).join('\n');
    }

    let rawItems;
    if (body.includes('\n')) {
        rawItems = body.split('\n');
    } else if (body.includes(',')) {
        rawItems = body.split(',');
    } else if (body.includes('•')) {
        rawItems = body.split('•');
    } else {
        rawItems = [body];
    }

    const items = rawItems
        .map(stripItem)
        .filter(Boolean);

    return { title, items };
}
