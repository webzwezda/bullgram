// Сценарий из test/test-sale-scan.js (разрезка под лимит pre-commit; хост — test/test-sale-scan.js).
import { loadScanCandidates } from '../../services/sale-scan.service.js';
import { assert, makeMockSupabase, makeAccountFixture, OWNER } from './shared.js';

export async function runLoadCandidatesScopes() {
console.log('— loadScanCandidates: скоупы unlisted/listed —');

{
    const supabase = makeMockSupabase({
        userbot_restore_sources: [
            { account_id: 'acc-free', owner_id: OWNER },
            { account_id: 'acc-listed', owner_id: OWNER }
        ],
        tg_accounts: [
            makeAccountFixture('acc-free', { custom_label: '+79…001' }),
            makeAccountFixture('acc-listed', { custom_label: '+79…002' })
        ],
        shop_items: [
            { id: 'item-lot', owner_id: OWNER, status: 'published' }
        ],
        shop_item_assets: [
            { shop_item_id: 'item-lot', asset_type: 'userbot', asset_id: 'acc-listed' }
        ]
    });

    const unlisted = await loadScanCandidates(supabase, OWNER, 'unlisted');
    assert(unlisted.accounts.length === 1 && unlisted.accounts[0].id === 'acc-free', 'unlisted: только без активного лота');
    assert(unlisted.orphanCount === 0, 'unlisted: orphans считаются');

    const listed = await loadScanCandidates(supabase, OWNER, 'listed');
    assert(listed.accounts.length === 1 && listed.accounts[0].id === 'acc-listed', 'listed: только выставленные');
    assert(listed.orphanCount === 0, 'listed: orphan-блобы к скоупу не относятся');
}
}
