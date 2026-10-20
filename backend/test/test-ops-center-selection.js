/**
 * Юнит-тесты резолва выбора юзербота для рабочего центра (/api/userbot/ops-center).
 * Запуск: node test/test-ops-center-selection.js
 *
 * Регрессия бага 2026-10-20: после подключения новой сессии на /connect список
 * на /userbot по умолчанию выбирает свежий импорт (created_at DESC), а ops-center
 * искал запрошенный id только среди operational-аккаунтов и отвечал 404
 * «Выбранный юзербот не найден» — центр целиком заменялся ошибкой, включая
 * селектор аккаунтов и кнопку активации safe-mode.
 *
 * Офлайн, детерминированные: чистая функция на fixtures, никакой сети.
 * Покрывает: приоритет reserved-ветки, safe_mode для запрошенного свежего
 * импорта (с другими operational и без них), no_operational, дефолтный выбор
 * operational[0], not_found для чужого id, нормализацию runtime_status.
 */
import {
    FRESH_IMPORT_RUNTIME_STATUS,
    isFreshImportedUserbot,
    resolveOpsCenterSelection
} from '../utils/ops-center-selection.js';

let failures = 0;
let passes = 0;
function ok(label) { passes++; console.log(`  ✓ ${label}`); }
function fail(label, expected, actual) {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
function assertTrue(cond, label) {
    if (cond) ok(label);
    else fail(label, true, cond);
}
function assertEqual(actual, expected, label) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
    else fail(label, expected, actual);
}

// --- Fixtures: живой кейс владельца из бага 2026-10-20 ---
// fresh — новейший (создан сегодня), два operational (online), один в shop.
const FRESH_ID = 'da3f507c-a4d3-48ba-85a4-d2f5eff244cd';
const ERIK_ID = '43cd7bf3-d38f-4e12-bcf5-c86c4906528b';
const COURTNEY_ID = '8cf7e60b-ab5c-4bbc-9ad4-5828d63327d6';
const RESERVED_ID = 'c051c650-10b3-4a7e-9a72-553dbc24417a';

function fixtures() {
    return [
        { id: FRESH_ID, runtime_status: 'pending_activation', tg_username: 'bookmarks_1968' },
        { id: ERIK_ID, runtime_status: 'online', tg_username: 'Erik' },
        { id: COURTNEY_ID, runtime_status: 'online', tg_username: 'Courtney' },
        { id: RESERVED_ID, runtime_status: 'online', tg_username: 'biybibl9' }
    ];
}
const RESERVED = new Set([RESERVED_ID]);

// --- isFreshImportedUserbot: нормализация как в роуте ---
assertTrue(isFreshImportedUserbot({ runtime_status: 'pending_activation' }), 'pending_activation → fresh');
assertTrue(isFreshImportedUserbot({ runtime_status: '  Pending_Activation ' }), 'регистр/пробелы нормализуются');
assertTrue(!isFreshImportedUserbot({ runtime_status: 'online' }), 'online → не fresh');
assertTrue(!isFreshImportedUserbot({}), 'без runtime_status → не fresh');
assertTrue(!isFreshImportedUserbot(null), 'null → не fresh');
assertEqual(FRESH_IMPORT_RUNTIME_STATUS, 'pending_activation', 'константа статуса не изменилась');

// --- Таблица решений ---
assertEqual(resolveOpsCenterSelection({ userbots: [], reservedUserbotIds: RESERVED, requestedUserbotId: null }).kind,
    'no_userbots', 'пустой список → no_userbots');

assertEqual(resolveOpsCenterSelection({ userbots: fixtures(), reservedUserbotIds: RESERVED, requestedUserbotId: RESERVED_ID }).kind,
    'reserved', 'запрошен id с витрины shop → reserved (409 с текстом про витрину)');

// Регрессия бага: запрошен свежий импорт при живых operational-соседях.
const freshPick = resolveOpsCenterSelection({ userbots: fixtures(), reservedUserbotIds: RESERVED, requestedUserbotId: FRESH_ID });
assertEqual(freshPick.kind, 'safe_mode', 'запрошен свежий импорт → safe_mode (раньше был 404 «Выбранный юзербот не найден»)');
assertEqual(freshPick.userbot?.id, FRESH_ID, 'safe_mode возвращает сам запрошенный аккаунт');
assertTrue(Array.isArray(freshPick.operationalUserbots) && freshPick.operationalUserbots.length === 2,
    'safe_mode отдаёт operational-соседей для селектора');

// Первый аккаунт владельца: свежий импорт без operational-соседей — центр
// обязан отрисоваться с кнопкой активации, а не 409 «нет ни одного активированного».
const firstAccount = resolveOpsCenterSelection({
    userbots: [{ id: FRESH_ID, runtime_status: 'pending_activation' }],
    reservedUserbotIds: new Set(),
    requestedUserbotId: FRESH_ID
});
assertEqual(firstAccount.kind, 'safe_mode', 'единственный аккаунт — свежий импорт → safe_mode (раньше 409 no_operational)');

assertEqual(resolveOpsCenterSelection({
    userbots: [{ id: FRESH_ID, runtime_status: 'pending_activation' }],
    reservedUserbotIds: new Set(),
    requestedUserbotId: null
}).kind, 'no_operational', 'нет запроса и все fresh → no_operational (409 про ручную активацию)');

const def = resolveOpsCenterSelection({ userbots: fixtures(), reservedUserbotIds: RESERVED, requestedUserbotId: null });
assertEqual(def.kind, 'ok', 'без запроса → ok');
assertEqual(def.userbot?.id, ERIK_ID, 'дефолт — первый operational по порядку created_at DESC');
assertEqual(def.operationalUserbots.map((item) => item.id), [ERIK_ID, COURTNEY_ID], 'operational без fresh и reserved');

assertEqual(resolveOpsCenterSelection({ userbots: fixtures(), reservedUserbotIds: RESERVED, requestedUserbotId: COURTNEY_ID }).userbot?.id,
    COURTNEY_ID, 'запрошен operational id → выбирается он');

assertEqual(resolveOpsCenterSelection({ userbots: fixtures(), reservedUserbotIds: RESERVED, requestedUserbotId: 'not-mine' }).kind,
    'not_found', 'чужой/несуществующий id → not_found (404)');

// reserved + fresh одновременно: ветка витрины приоритетнее, как в старом порядке проверок.
const reservedFresh = resolveOpsCenterSelection({
    userbots: [{ id: RESERVED_ID, runtime_status: 'pending_activation' }],
    reservedUserbotIds: new Set([RESERVED_ID]),
    requestedUserbotId: RESERVED_ID
});
assertEqual(reservedFresh.kind, 'reserved', 'fresh на витрине → reserved, не safe_mode');

console.log(failures === 0 ? `\nOK: ${passes} проверок прошло` : `\nFAILED: ${failures} упало, ${passes} прошло`);
process.exit(failures === 0 ? 0 : 1);
