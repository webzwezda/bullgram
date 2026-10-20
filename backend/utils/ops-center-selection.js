// Резолв выбора юзербота для рабочего центра (/api/userbot/ops-center).
// Чистая функция без сети: роут превращает результат в HTTP-ответ,
// юнит-тесты (test/test-ops-center-selection.js) гоняют таблицу решений.

export const FRESH_IMPORT_RUNTIME_STATUS = 'pending_activation';

export function isFreshImportedUserbot(userbot) {
    return String(userbot?.runtime_status || '').trim().toLowerCase() === FRESH_IMPORT_RUNTIME_STATUS;
}

// Порядок веток сохраняет порядок проверок роуты: витрина shop приоритетнее
// safe-mode, safe_mode (запрошенный свежий импорт) — приоритетнее 409 про
// «нет ни одного активированного», чтобы центр отрисовался с кнопкой активации.
export function resolveOpsCenterSelection({ userbots, reservedUserbotIds, requestedUserbotId }) {
    if (!userbots || userbots.length === 0) {
        return { kind: 'no_userbots' };
    }

    if (requestedUserbotId && reservedUserbotIds.has(requestedUserbotId)) {
        return { kind: 'reserved' };
    }

    const operationalUserbots = userbots.filter((item) =>
        !reservedUserbotIds.has(String(item.id)) &&
        !isFreshImportedUserbot(item)
    );

    const requestedUserbot = requestedUserbotId
        ? userbots.find((item) => String(item.id) === requestedUserbotId)
        : null;

    if (requestedUserbot && isFreshImportedUserbot(requestedUserbot)) {
        return { kind: 'safe_mode', userbot: requestedUserbot, operationalUserbots };
    }

    if (operationalUserbots.length === 0) {
        return { kind: 'no_operational' };
    }

    const preferredUserbot = requestedUserbotId
        ? operationalUserbots.find((item) => String(item.id) === requestedUserbotId)
        : operationalUserbots[0];

    if (!preferredUserbot) {
        return { kind: 'not_found' };
    }

    return { kind: 'ok', userbot: preferredUserbot, operationalUserbots };
}
