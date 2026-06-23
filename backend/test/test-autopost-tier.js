/**
 * Юнит-тесты tier-gating для автопостера и связанных правил.
 * Запуск: node test/test-autopost-tier.js
 *
 * Покрывает синхронные проверки (getTierRules, ensureBroadcastAllowed,
 * ensureShopSellerAllowed) и enforceAutopostBotQuota с моком supabase.
 */
import {
    getTierRules,
    getProductTier,
    ensureBroadcastAllowed,
    ensureShopSellerAllowed,
    enforceAutopostBotQuota
} from '../utils/product-tier.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}
function assertThrows(fn, label) {
    try {
        fn();
        console.error(`  ✗ ${label} (no throw)`);
        failures++;
    } catch (e) {
        console.log(`  ✓ ${label} (${e.message.slice(0, 60)}…)`);
    }
}

console.log('--- product-tier.getProductTier ---');
{
    assert(getProductTier({ product_tier: 'trial' }) === 'trial', 'trial → trial');
    assert(getProductTier({ product_tier: 'Normal' }) === 'normal', 'Normal (capitalized) → normal');
    assert(getProductTier({ product_tier: 'PRO' }) === 'pro', 'PRO (caps) → pro');
    assert(getProductTier({}) === 'trial', 'missing tier → trial');
    assert(getProductTier(null) === 'trial', 'null profile → trial');
    assert(getProductTier({ product_tier: 'seller' }) === 'seller', 'seller (legacy) → seller (falls through to default trial rules)');
}

console.log('\n--- product-tier.getTierRules ---');
{
    const trial = getTierRules({ product_tier: 'trial' });
    assert(trial.maxAutopostBots === 1, 'trial.maxAutopostBots = 1');
    assert(trial.canSendBroadcasts === false, 'trial.canSendBroadcasts = false');
    assert(trial.canUseShopSeller === false, 'trial.canUseShopSeller = false');

    const normal = getTierRules({ product_tier: 'normal' });
    assert(normal.maxAutopostBots === 3, 'normal.maxAutopostBots = 3');
    assert(normal.canSendBroadcasts === true, 'normal.canSendBroadcasts = true');

    const pro = getTierRules({ product_tier: 'pro' });
    assert(pro.maxAutopostBots === 3, 'pro.maxAutopostBots = 3 (matches normal)');
}

console.log('\n--- product-tier.ensureBroadcastAllowed ---');
{
    assertThrows(() => ensureBroadcastAllowed({ product_tier: 'trial' }), 'trial cannot broadcast');
    try {
        ensureBroadcastAllowed({ product_tier: 'normal' });
        console.log('  ✓ normal can broadcast');
    } catch (e) {
        console.error(`  ✗ normal can broadcast (threw: ${e.message})`);
        failures++;
    }
}

console.log('\n--- product-tier.ensureShopSellerAllowed ---');
{
    assertThrows(() => ensureShopSellerAllowed({ product_tier: 'trial' }), 'trial cannot use shop seller');
    assertThrows(() => ensureShopSellerAllowed({ product_tier: 'trial', role: 'user' }), 'trial user cannot use shop seller');

    try {
        ensureShopSellerAllowed({ product_tier: 'trial', role: 'admin' });
        console.log('  ✓ admin bypasses shop seller check');
    } catch (e) {
        console.error(`  ✗ admin bypass (threw: ${e.message})`);
        failures++;
    }
}

console.log('\n--- product-tier.enforceAutopostBotQuota ---');
{
    // Мок supabase: строим цепочку, возвращающую данные.
    function makeMock(existingCount) {
        return {
            _from: null,
            _eqField: null,
            _eqValue: null,
            from(table) {
                this._from = table;
                return this;
            },
            select(col) {
                this._select = col;
                return this;
            },
            eq(field, value) {
                if (this._eqField === null) {
                    this._eqField = field;
                    this._eqValue = value;
                    return this;
                }
                return this; // ignore subsequent eq chains
            },
            then(resolve) {
                // Resolve with synthetic data: array of `existingCount` rows
                const data = Array.from({ length: existingCount }, (_, i) => ({ id: `bot-${i}` }));
                resolve({ data, error: null });
            }
        };
    }

    // Trial at limit (1 bot exists, limit 1) → throws
    await enforceAutopostBotQuota({
        supabase: makeMock(1),
        ownerId: 'user-1',
        profile: { product_tier: 'trial' }
    }).then(
        () => { console.error('  ✗ trial at limit should throw'); failures++; },
        (e) => { console.log(`  ✓ trial at limit throws (${e.message.slice(0, 60)}…)`); }
    );

    // Trial under limit (0 bots, limit 1) → ok
    await enforceAutopostBotQuota({
        supabase: makeMock(0),
        ownerId: 'user-2',
        profile: { product_tier: 'trial' }
    }).then(
        () => { console.log('  ✓ trial under limit passes'); },
        (e) => { console.error(`  ✗ trial under limit should pass (${e.message})`); failures++; }
    );

    // Normal at limit (3 bots, limit 3) → throws
    await enforceAutopostBotQuota({
        supabase: makeMock(3),
        ownerId: 'user-3',
        profile: { product_tier: 'normal' }
    }).then(
        () => { console.error('  ✗ normal at limit should throw'); failures++; },
        (e) => { console.log(`  ✓ normal at limit throws (${e.message.slice(0, 60)}…)`); }
    );

    // Normal under limit (2 bots, limit 3) → ok
    await enforceAutopostBotQuota({
        supabase: makeMock(2),
        ownerId: 'user-4',
        profile: { product_tier: 'normal' }
    }).then(
        () => { console.log('  ✓ normal under limit passes'); },
        (e) => { console.error(`  ✗ normal under limit should pass (${e.message})`); failures++; }
    );

    // Admin bypasses regardless of count
    await enforceAutopostBotQuota({
        supabase: makeMock(100),
        ownerId: 'admin-1',
        profile: { product_tier: 'trial', role: 'admin' }
    }).then(
        () => { console.log('  ✓ admin bypasses quota regardless of count'); },
        (e) => { console.error(`  ✗ admin should bypass (${e.message})`); failures++; }
    );
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All tier tests passed');
