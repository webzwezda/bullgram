/**
 * Чек-листы автопостера: чистые функции — рендер, summary, валидация, статус,
 * callback_data и семантика правок списка. Никакого I/O: supabase живёт в
 * autopost.service.js, Telegram — в sender.js/хендлерах.
 * План: docs/plans/2026-09-17-autopost-checklists.md
 */
import crypto from 'crypto';
import { Markup } from 'telegraf';

const CALLBACK_PREFIX = 'cli:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Капы лейбла кнопки: лимит InlineKeyboardButton.text — 64 символа.
// Текст пункта ≤48, имя отметившего ≤24; при переполнении режем имя первой
// (иначе честное длинное имя валит публикацию в 400).
const ITEM_TEXT_CAP = 48;
const NAME_CAP = 24;
const LABEL_CAP = 64;

export function packCallbackData(itemId) {
    return `${CALLBACK_PREFIX}${itemId}`;
}

export function parseCallbackData(str) {
    const raw = String(str ?? '');
    if (!raw.startsWith(CALLBACK_PREFIX)) return null;
    const id = raw.slice(CALLBACK_PREFIX.length);
    return UUID_RE.test(id) ? id : null;
}

function truncate(value, cap) {
    return String(value ?? '').slice(0, cap);
}

function buildItemLabel(item, showNames) {
    const checked = item?.is_checked === true;
    const prefix = checked ? '✅ ' : '⬜ ';
    const text = truncate(item?.text, ITEM_TEXT_CAP);
    let name = checked && showNames ? truncate(item?.checked_by_name, NAME_CAP) : '';

    const join = (t, n) => prefix + t + (n ? ` — ${n}` : '');
    let label = join(text, name);
    if (label.length <= LABEL_CAP) return label;

    // Переполнение: сначала режем имя — текст пункта важнее атрибуции.
    if (name) {
        const nameBudget = LABEL_CAP - prefix.length - text.length - 3; // ' — '.length
        name = nameBudget >= 1 ? name.slice(0, nameBudget) : '';
        label = join(text, name);
    }
    if (label.length <= LABEL_CAP) return label;

    // Всё ещё длинно (кто-то передал текст длиннее капа) — режем текст.
    const suffix = name ? ` — ${name}` : '';
    const textBudget = Math.max(0, LABEL_CAP - prefix.length - suffix.length);
    return join(text.slice(0, textBudget), name);
}

/**
 * Текст + клавиатура чек-листа. Текст сообщения = только название (без
 * технички: прогресс видно по кнопкам ✅/⬜, сводку агент забирает через
 * checklist_state → renderChecklistSummary). Пустой заголовок → «☑️»,
 * т.к. Telegram не принимает пустой текст.
 * Возвращает replyMarkup как сырой объект { inline_keyboard } — удобно
 * прокидывать в reply_markup sendMessage/editMessageText.
 */
export function buildChecklistMessage(checklist, items, { showNames = true } = {}) {
    const text = String(checklist?.title ?? '').trim() || '☑️';
    const ordered = [...(Array.isArray(items) ? items : [])].sort(
        (a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0)
    );
    // Один пункт = один ряд клавиатуры (плоский массив Telegraf склеил бы в один ряд).
    const buttons = ordered.map((it) => [
        Markup.button.callback(buildItemLabel(it, showNames !== false), packCallbackData(it?.id))
    ]);
    return { text, replyMarkup: Markup.inlineKeyboard(buttons).reply_markup };
}

function formatHHMM(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

/**
 * Человекочитаемый итог для state-инструмента и сводок агента:
 * «Итог: 2 из 3 — картошка ✅ (Вася, 10:12), капуста ⬜»
 */
export function renderChecklistSummary(checklist, items) {
    const ordered = [...(Array.isArray(items) ? items : [])].sort(
        (a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0)
    );
    const done = ordered.filter((it) => it?.is_checked === true).length;
    const head = `Итог: ${done} из ${ordered.length}`;
    if (ordered.length === 0) return head;

    const parts = ordered.map((item) => {
        const text = String(item?.text ?? '');
        if (item?.is_checked !== true) return `${text} ⬜`;
        const meta = [item?.checked_by_name, formatHHMM(item?.checked_at)].filter(Boolean);
        return meta.length > 0 ? `${text} ✅ (${meta.join(', ')})` : `${text} ✅`;
    });
    return `${head} — ${parts.join(', ')}`;
}

/**
 * Капы входа (валидация в хендлерах — dispatch args по inputSchema не валидирует):
 * пунктов 1–25, текст пункта 1–100 после trim, заголовок 0–200, dedup_key ≤128.
 */
export function validateChecklistInput({ title, items, dedupKey } = {}) {
    const safeTitle = title === null || title === undefined ? '' : String(title);
    if (safeTitle.length > 200) {
        return { ok: false, error: `Заголовок длиннее 200 символов (сейчас ${safeTitle.length})` };
    }
    if (!Array.isArray(items) || items.length < 1) {
        return { ok: false, error: 'Нужен хотя бы один пункт' };
    }
    if (items.length > 25) {
        return { ok: false, error: `Максимум 25 пунктов (сейчас ${items.length})` };
    }
    for (const raw of items) {
        const text = String(raw ?? '').trim();
        if (text.length < 1) {
            return { ok: false, error: 'Пункт не может быть пустым' };
        }
        if (text.length > 100) {
            return { ok: false, error: `Пункт длиннее 100 символов (сейчас ${text.length}): «${text.slice(0, 30)}…»` };
        }
    }
    if (dedupKey !== null && dedupKey !== undefined && String(dedupKey).length > 128) {
        return { ok: false, error: `dedup_key длиннее 128 символов (сейчас ${String(dedupKey).length})` };
    }
    return { ok: true };
}

/**
 * Вычисляемый статус, без новых статусов у autopost_items:
 * active (по умолчанию) / expired (expires_at < now) / cancelled (cancelled_at не пуст).
 * Отмена старше истечения — закрытый список не «воскресает» по TTL.
 */
export function computeChecklistStatus(checklist) {
    if (!checklist) return 'active';
    if (checklist.cancelled_at) return 'cancelled';
    if (checklist.expires_at && new Date(checklist.expires_at).getTime() < Date.now()) return 'expired';
    return 'active';
}

/**
 * Чистая проекция правок списка: что станет с items и какие события записать.
 * Порядок применения: reset → remove → rename → add.
 * rename переносит отметку по item_id (текст — плохой ключ: дубликаты делают
 * match неоднозначным); text-match не используем вовсе.
 * Не найденный item_id → Error('ITEM_NOT_FOUND') — маппится в NOT_FOUND выше.
 */
export function applyChecklistOps(items, { add, rename, remove, reset } = {}) {
    let next = [...(Array.isArray(items) ? items : [])];
    const events = [];

    if (reset === true) {
        next = next.map((it) => ({
            ...it,
            is_checked: false,
            checked_by_tg_id: null,
            checked_by_name: null,
            checked_at: null
        }));
        events.push({ item_id: null, action: 'reset' });
    }

    for (const rawId of Array.isArray(remove) ? remove : []) {
        const id = String(rawId);
        if (!next.some((it) => String(it.id) === id)) throw new Error('ITEM_NOT_FOUND');
        next = next.filter((it) => String(it.id) !== id);
        events.push({ item_id: id, action: 'removed' });
    }

    for (const r of Array.isArray(rename) ? rename : []) {
        const id = String(r?.item_id);
        const idx = next.findIndex((it) => String(it.id) === id);
        if (idx === -1) throw new Error('ITEM_NOT_FOUND');
        next[idx] = { ...next[idx], text: String(r?.text ?? '').trim() };
        events.push({ item_id: id, action: 'renamed' });
    }

    const adds = Array.isArray(add) ? add : [];
    if (adds.length > 0) {
        const maxPos = next.reduce((m, it) => Math.max(m, Number(it?.position ?? 0)), 0);
        adds.forEach((raw, i) => {
            const id = crypto.randomUUID();
            next.push({
                id,
                text: String(raw ?? '').trim(),
                position: maxPos + 1 + i,
                is_checked: false,
                checked_by_tg_id: null,
                checked_by_name: null,
                checked_at: null
            });
            events.push({ item_id: id, action: 'added' });
        });
    }

    return { items: next, events };
}
