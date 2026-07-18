/**
 * Inline keyboard для чеклиста.
 * One button per row. Checkbox char prefix показывает состояние.
 *
 * Лимиты Telegram:
 *   - button.text до 64 utf16 chars
 *   - callback_data до 64 байт
 *
 * callback_data формат: 'chk:<listId>:<idx>'. listId это UUID (36 chars),
 * idx до 2 цифр → всего ~43 байта. Безопасно.
 */

const CHECK = '✅';
const UNCHECK = '⬜';
const MAX_BUTTON_TEXT = 64;

export function buildKeyboard(list) {
    const items = Array.isArray(list.items)
        ? list.items
        : (list.checklist_items || []);
    const sorted = [...items].sort((a, b) => (a.position || 0) - (b.position || 0));

    return {
        inline_keyboard: sorted.map((item, idx) => {
            const prefix = item.checked ? CHECK : UNCHECK;
            const text = `${prefix} ${String(item.text || '')}`.slice(0, MAX_BUTTON_TEXT);
            return [{
                text,
                callback_data: `chk:${list.id}:${idx}`
            }];
        })
    };
}
