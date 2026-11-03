// Правила продажи аккаунтов (решение владельца 2026-11-03). Аккаунт подлежит
// продаже, когда выполняется ВСЁ:
//   1. tdata-блоб сохранён (`userbot_restore_sources.tdata_blob_encrypted`
//      not null) — покупатель получает полный комплект;
//   2. проверка свежая (≤6 ч) и health говорит online — как у гейта выдачи;
//   3. отлёжка: с импорта (`tg_accounts.created_at`) прошло
//      ≥ SHOP_ACCOUNT_MIN_REST_HOURS часов (default 48).
// Единственный источник правил: `accountSaleRuleState` — им считают sellable
// и скан «Найти аккаунты для продажи», и батч-гейт createAccountLotsBatch.
// Гейт выдачи/брони аккаунт-лотов (shop-delivery.service.js) переиспользует
// отсюда окно свежести и семантику «живого» статуса — для уже выставленных
// лотов tdata/отлёжка проверены при выставлении и повторно не меняются.

// Окно свежести проверки: раньше жило в shop-delivery.service.js — сведено
// сюда, чтобы у скана и выдачи не разъехалось.
export const ACCOUNT_FRESH_CHECK_WINDOW_MS = 6 * 60 * 60 * 1000;

export const ACCOUNT_NO_TDATA_MESSAGE = 'Нет tdata-архива';
export const ACCOUNT_CHECK_STALE_MESSAGE = 'Проверка устарела — запусти скан заново';
// Тот же текст, что ACCOUNT_LOT_NOT_READY_MESSAGE в shop-delivery.service.js
// (там он реэкспортируется) — один источник, чтобы формулировки не расползлись.
export const ACCOUNT_NOT_READY_MESSAGE = 'Аккаунт не готов к продаже: запусти проверку Telegram (Гигиена аккаунтов)';

const DEFAULT_MIN_REST_HOURS = 48;

// Отлёжка в часах: env SHOP_ACCOUNT_MIN_REST_HOURS, default 48, отрицательные
// и мусор игнорируем (0 = правило отлёжки выключено).
export function getAccountMinRestHours() {
    const raw = Number(process.env.SHOP_ACCOUNT_MIN_REST_HOURS);
    if (!Number.isFinite(raw) || raw < 0) return DEFAULT_MIN_REST_HOURS;
    return raw;
}

// Часы с импорта. Без created_at считаем отлёжку нулевой — правило честно
// фейлится («дай аккаунту отлежаться»), а не пропускает непроверенное.
export function accountRestHours(createdAt, nowMs = Date.now()) {
    const ts = createdAt ? new Date(createdAt).getTime() : 0;
    if (!ts || !Number.isFinite(ts)) return 0;
    return Math.max(0, (nowMs - ts) / (60 * 60 * 1000));
}

function isFreshCheck(row, nowMs) {
    const checkedAt = row?.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
    return Boolean(checkedAt) && (nowMs - checkedAt) <= ACCOUNT_FRESH_CHECK_WINDOW_MS;
}

function accountHealthStatus(row) {
    return String(row?.health_summary?.status || '').trim().toLowerCase();
}

// «Живой» статус со свежей проверкой — прежняя семантика гейта аккаунт-лотов:
// online со свежим чеком; pending_activation только со свежим чеком и
// health_summary.status='online'. Всё остальное — отстойник/неизвестное.
export function isFreshHealthyAccount(row, nowMs = Date.now()) {
    const status = String(row?.runtime_status || '').trim().toLowerCase();
    if (status === 'online') return isFreshCheck(row, nowMs);
    if (status === 'pending_activation') {
        return accountHealthStatus(row) === 'online' && isFreshCheck(row, nowMs);
    }
    return false;
}

// Полное правило продажи → { sellable, reasons }. reasons — честные причины
// по-русски в порядке важности: статус → свежесть → tdata → отлёжка. Первую
// причину показываем админу как основной текст («Проблемные» скана, ошибки
// батч-выставления). now/minRestHours — инъекция для тестов.
export function accountSaleRuleState(account, { now = Date.now(), minRestHours = getAccountMinRestHours() } = {}) {
    const nowMs = Number(now) || Date.now();
    const minRest = Number(minRestHours);
    const reasons = [];

    const status = String(account?.runtime_status || '').trim().toLowerCase();
    const statusOk = status === 'online' || status === 'pending_activation';
    if (!statusOk) {
        reasons.push(ACCOUNT_NOT_READY_MESSAGE);
    } else if (!isFreshHealthyAccount(account, nowMs)) {
        reasons.push(ACCOUNT_CHECK_STALE_MESSAGE);
    }

    if (account?.has_tdata !== true) {
        reasons.push(ACCOUNT_NO_TDATA_MESSAGE);
    }

    const restHours = accountRestHours(account?.created_at, nowMs);
    if (Number.isFinite(minRest) && minRest > 0 && restHours < minRest) {
        reasons.push(`Отлёжка ${Math.floor(restHours)}ч из ${minRest}ч — дай аккаунту отлежаться`);
    }

    return { sellable: reasons.length === 0, reasons };
}
