// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { isMissingScanTableError, SALE_SCAN_MISSING_MIGRATION_MESSAGE } from '../../services/sale-scan.service.js';
import { assert } from './shared.js';

export async function runMissingScanTableError() {
console.log('— isMissingScanTableError —');

{
    assert(isMissingScanTableError({ message: 'relation "public.account_sale_scans" does not exist' }), 'текст с account_sale_scans распознан');
    assert(isMissingScanTableError({ code: '42P01', message: 'relation does not exist' }), 'код 42P01 распознан');
    assert(!isMissingScanTableError({ message: 'relation "public.shop_items" does not exist' }), 'чужая таблица не распознана');
    assert(SALE_SCAN_MISSING_MIGRATION_MESSAGE.includes('account sale scan'), 'сообщение про SQL упомянет миграцию');
}
}
