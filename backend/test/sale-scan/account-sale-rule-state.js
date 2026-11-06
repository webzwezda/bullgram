// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { ACCOUNT_CHECK_STALE_MESSAGE, ACCOUNT_NO_TDATA_MESSAGE, ACCOUNT_NOT_READY_MESSAGE, accountSaleRuleState, getAccountMinRestHours } from '../../utils/account-sale-rules.js';
import { assert, THIRTY_DAYS_AGO } from './shared.js';

export async function runAccountSaleRuleState() {
console.log('— accountSaleRuleState: tdata + отлёжка + свежесть —');

{
    const nowMs = Date.now();

    const noTdata = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: { status: 'online' },
        created_at: THIRTY_DAYS_AGO,
        has_tdata: false
    }, { now: nowMs });
    assert(noTdata.sellable === false, 'правило: без tdata не sellable');
    assert(noTdata.reasons.includes(ACCOUNT_NO_TDATA_MESSAGE), `правило: причина «${ACCOUNT_NO_TDATA_MESSAGE}»`);

    const freshImport = accountSaleRuleState({
        runtime_status: 'pending_activation',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: { status: 'online' },
        created_at: new Date(nowMs - 5 * 60 * 60 * 1000).toISOString(),
        has_tdata: true
    }, { now: nowMs });
    assert(freshImport.sellable === false, 'правило: отлёжка 5ч < 48ч не sellable');
    assert(
        freshImport.reasons.some((reason) => reason === 'Отлёжка 5ч из 48ч — дай аккаунту отлежаться'),
        'правило: причина «Отлёжка 5ч из 48ч — дай аккаунту отлежаться»'
    );

    const rested = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: null,
        created_at: new Date(nowMs - 50 * 60 * 60 * 1000).toISOString(),
        has_tdata: true
    }, { now: nowMs });
    assert(rested.sellable === true && rested.reasons.length === 0, 'правило: отлёжка 50ч + tdata → sellable');

    const onBoundary = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: null,
        created_at: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
        has_tdata: true
    }, { now: nowMs });
    assert(onBoundary.sellable === true, 'правило: ровно 48ч на границе → sellable');

    const staleCheck = accountSaleRuleState({
        runtime_status: 'online',
        last_checked_at: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
        health_summary: null,
        created_at: THIRTY_DAYS_AGO,
        has_tdata: true
    }, { now: nowMs });
    assert(staleCheck.sellable === false && staleCheck.reasons.includes(ACCOUNT_CHECK_STALE_MESSAGE), 'правило: устаревший чек → «Проверка устарела — запусти скан заново»');

    const frozen = accountSaleRuleState({
        runtime_status: 'frozen',
        last_checked_at: new Date(nowMs).toISOString(),
        health_summary: { status: 'online' },
        created_at: THIRTY_DAYS_AGO,
        has_tdata: true
    }, { now: nowMs });
    assert(frozen.sellable === false && frozen.reasons[0] === ACCOUNT_NOT_READY_MESSAGE, 'правило: плохой статус → текст «не готов к продаже» первым');

    assert(getAccountMinRestHours() === 48, 'getAccountMinRestHours: default 48');
    process.env.SHOP_ACCOUNT_MIN_REST_HOURS = '24';
    assert(getAccountMinRestHours() === 24, 'getAccountMinRestHours: env переопределяет');
    process.env.SHOP_ACCOUNT_MIN_REST_HOURS = '-5';
    assert(getAccountMinRestHours() === 48, 'getAccountMinRestHours: отрицательное игнорируется → default');
    delete process.env.SHOP_ACCOUNT_MIN_REST_HOURS;
}
}
