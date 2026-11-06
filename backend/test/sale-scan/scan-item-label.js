// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { scanItemLabel } from '../../services/sale-scan.service.js';
import { assert } from './shared.js';

export async function runScanItemLabel() {
console.log('— scanItemLabel —');

{
    assert(scanItemLabel({ custom_label: '+79…001', tg_username: 'u', tg_account_id: '1', id: 'x' }) === '+79…001', 'label: custom_label первым');
    assert(scanItemLabel({ custom_label: null, tg_username: 'acc_user', tg_account_id: '555', id: 'x' }) === 'acc_user', 'label: юзернейм вторым');
    assert(scanItemLabel({ custom_label: null, tg_username: null, tg_account_id: '555', id: 'x' }) === '555', 'label: tg_account_id третьим');
    assert(scanItemLabel({ id: 'acc-plain' }) === 'acc-plain', 'label: id как последний резерв');
}
}
