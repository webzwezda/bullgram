import {
    NOW,
    assertEqual, assertTrue,
    makeAccount, estimateCapacity, isActorEligible, resolveMessagingCaps
} from './shared.js';

// ---------------------------------------------------------------------------
// 1. Pure: resolveMessagingCaps
// ---------------------------------------------------------------------------
console.log('\n[resolveMessagingCaps]');
{
  assertEqual(resolveMessagingCaps({}), { hourlyCap: 20, dailyCap: 50, jitterPercent: 20 }, 'defaults');
  assertEqual(
    resolveMessagingCaps({ USERBOT_DM_HOURLY_CAP: '35', USERBOT_DM_DAILY_CAP: '80', USERBOT_DM_JITTER_PERCENT: '10' }),
    { hourlyCap: 35, dailyCap: 80, jitterPercent: 10 },
    'overrides from env'
  );
  assertEqual(
    resolveMessagingCaps({ USERBOT_DM_HOURLY_CAP: 'abc', USERBOT_DM_DAILY_CAP: '', USERBOT_DM_JITTER_PERCENT: 'x7' }),
    { hourlyCap: 20, dailyCap: 50, jitterPercent: 20 },
    'non-numeric → defaults'
  );
  assertEqual(
    resolveMessagingCaps({ USERBOT_DM_HOURLY_CAP: '-3', USERBOT_DM_DAILY_CAP: '-10', USERBOT_DM_JITTER_PERCENT: '-1' }),
    { hourlyCap: 20, dailyCap: 50, jitterPercent: 20 },
    'negative → defaults'
  );
}

// ---------------------------------------------------------------------------
// 2. Pure: estimateCapacity
// ---------------------------------------------------------------------------
console.log('\n[estimateCapacity]');
{
  assertEqual(
    estimateCapacity({ audienceSize: 120, poolSize: 3, dailyCap: 50 }),
    { audienceSize: 120, poolSize: 3, dailyCap: 50, botsNeeded: 3, days: 1 },
    '120 / (3×50) → 3 бота, 1 день'
  );
  assertEqual(
    estimateCapacity({ audienceSize: 120, poolSize: 1, dailyCap: 50 }),
    { audienceSize: 120, poolSize: 1, dailyCap: 50, botsNeeded: 3, days: 3 },
    'один бот растягивает на 3 дня'
  );
  assertEqual(
    estimateCapacity({ audienceSize: 101, poolSize: 2, dailyCap: 50 }),
    { audienceSize: 101, poolSize: 2, dailyCap: 50, botsNeeded: 3, days: 2 },
    'ceil по обеим формулам'
  );
  const impossible = estimateCapacity({ audienceSize: 120, poolSize: 0, dailyCap: 50 });
  assertEqual(impossible.botsNeeded, 3, 'pool 0 → botsNeeded считается');
  assertEqual(impossible.days, null, 'pool 0 → days null (невозможно)');
  assertEqual(
    estimateCapacity({ audienceSize: 0, poolSize: 0, dailyCap: 50 }),
    { audienceSize: 0, poolSize: 0, dailyCap: 50, botsNeeded: 0, days: 0 },
    'audience 0 + pool 0 → оба 0'
  );
  assertEqual(
    estimateCapacity({ audienceSize: 0, poolSize: 3, dailyCap: 50 }),
    { audienceSize: 0, poolSize: 3, dailyCap: 50, botsNeeded: 0, days: 0 },
    'audience 0 → оба 0 даже с пулом'
  );
}

// ---------------------------------------------------------------------------
// 3. Pure: isActorEligible
// ---------------------------------------------------------------------------
console.log('\n[isActorEligible]');
{
  assertTrue(!isActorEligible(null), 'null account → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'pending_activation' })), 'pending_activation → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'restricted' })), 'restricted → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'expired' })), 'expired → false');
  assertTrue(!isActorEligible(makeAccount('a', { runtime_status: 'error' })), 'error → false');
  assertTrue(!isActorEligible(makeAccount('a', { proxy_id: 'p1', proxies: { is_working: false } })), 'dead proxy → false');
  assertTrue(isActorEligible(makeAccount('a', { proxy_id: 'p1', proxies: { is_working: true } })), 'live proxy → true');
  assertTrue(
    !isActorEligible(makeAccount('a', { dm_paused_until: new Date(NOW + 5000).toISOString() }), { now: NOW }),
    'future pause (ISO string) → false'
  );
  assertTrue(
    isActorEligible(makeAccount('a', { dm_paused_until: new Date(NOW - 5000).toISOString() }), { now: NOW }),
    'past pause → true'
  );
  assertTrue(
    isActorEligible(makeAccount('a', { dm_paused_until: new Date(NOW + 5000).toISOString() }), { now: NOW + 10000 }),
    'pause expired by now → true'
  );
  assertTrue(isActorEligible(makeAccount('a')), 'clean account → true');
}
