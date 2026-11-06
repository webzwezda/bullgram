// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import { findUnsellableAccountLot } from '../../services/shop-delivery.service.js';
import { assert, accountRow, STALE_ISO } from './shared.js';

export async function runAccountLotGate() {
console.log('— Гейт аккаунт-лотов (создание/бронь/выдача) —');

{
    assert(findUnsellableAccountLot([accountRow()]) === null, 'pending_activation свежий + health online → продаётся');
    assert(findUnsellableAccountLot([accountRow({ last_checked_at: STALE_ISO })]) !== null, 'pending_activation устаревший → карантин');
    assert(findUnsellableAccountLot([accountRow({ health_summary: null })]) !== null, 'pending_activation без health → карантин');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'frozen' })]) !== null, 'frozen → карантин');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'restricted' })]) !== null, 'restricted → карантин');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'online' })]) === null, 'online свежий → продаётся');
    assert(findUnsellableAccountLot([accountRow({ runtime_status: 'online', last_checked_at: STALE_ISO })]) !== null, 'online устаревший → карантин');
}
}
